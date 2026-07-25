/**
 * C6.2 — Sincronizador de cupons (offline-first). Dois passos, ambos tolerantes
 * a estar sem sinal:
 *   1. UPLOAD — drena a `fila_upload`, enviando o QR cru ao backend. A
 *      idempotência real é do servidor (dedup por `chave_acesso`, extraída do
 *      próprio QR), então reenviar nunca duplica nota.
 *   2. PROCESSAMENTO — a ingestão é assíncrona (202 + fila no backend); aqui
 *      consultamos o cupom no servidor e, quando `processado`/`falha`, gravamos
 *      o cabeçalho + itens no espelho privado local (C6.3).
 *
 * Falhas de rede/servidor são TRANSITÓRIAS (retry com backoff exponencial);
 * QR inválido (400) é PERMANENTE (marca `falha` e sai da fila). Sessão ausente
 * ou expirada (401) é transitório — quando o usuário entra (C4.3.1), o app
 * renova o token e a próxima rodada envia.
 */

import type { CupomResponse, HistoricoCupom, IngestaoQrResponse } from '@barganha/shared';

import { clienteApi, ErroApi } from '@/api';
import { cache, cupons, fila, lista, meta, produtos } from '@/dados';
import type { CupomLocal, CupomRestaurado, ItemFilaUpload } from '@/dados';
import { escoposSync, resolverLocalizacao } from '@/nucleo/localizacao';
import { contarFalha, limparFalhas, log } from '@/nucleo/log';

/** Backoff: 15s, 30s, 1min… até o teto de 1h. */
const BACKOFF_BASE_S = 15;
const BACKOFF_MAX_S = 60 * 60;

/**
 * Teto de páginas do delta por rodada. O cursor é persistido a cada página, então
 * parar aqui não perde nada — a próxima rodada continua. Existe só para uma
 * resposta anômala do servidor não prender o app num laço.
 */
const MAX_PAGINAS_DELTA = 50;

function emSegundos(segundos: number): string {
  return new Date(Date.now() + segundos * 1000).toISOString();
}

function atrasoBackoff(tentativas: number): string {
  const s = Math.min(BACKOFF_BASE_S * 2 ** tentativas, BACKOFF_MAX_S);
  return emSegundos(s);
}

/** Erros que não adianta repetir (corrigir a origem, não tentar de novo). */
function ehPermanente(erro: unknown): boolean {
  // 400 = QR inválido pelo backend. 401 NÃO é permanente: a sessão expirou e o
  // app renova ao logar; demais 4xx/5xx/rede são transitórios.
  return erro instanceof ErroApi && erro.status === 400;
}

// Single-flight: evita duas rodadas concorrentes drenando a mesma fila.
let rodando = false;

/**
 * Grava o vínculo com o servidor após o upload. Dois cuidados:
 *  • `chaveAcesso` devolvida pelo backend entra no espelho local — ativa a
 *    idempotência local por chave (índice único, docs/05).
 *  • Quando o servidor DEDUPLICA (o cupom já estava `processado` lá — re-scan
 *    após descarte/reinstalação), o status local fica `qr_capturado`: os itens
 *    ainda não existem aqui, e é esse status que faz o polling buscá-los.
 *    Marcar `processado` sem itens congelava um espelho vazio para sempre.
 */
async function vincularUpload(cupomLocalId: string, resp: IngestaoQrResponse): Promise<void> {
  const status = resp.status === 'processado' ? 'qr_capturado' : resp.status;
  await cupons.vincularServidor(cupomLocalId, resp.cupomId, status, resp.chaveAcesso);
}

/** Envia UM cupom enfileirado. Lança em erro transitório (para o backoff). */
async function enviarCupom(item: ItemFilaUpload): Promise<void> {
  const cupom = await cupons.obterCupom(item.cupomLocalId);
  if (!cupom) {
    // Cupom sumiu (descartado) — limpa a fila órfã.
    await fila.removerDaFila(item.cupomLocalId);
    return;
  }
  if (cupom.cupomIdServidor) {
    // Já subiu numa tentativa anterior; só não saiu da fila. Conclui.
    await fila.removerDaFila(item.cupomLocalId);
    return;
  }

  try {
    const resp = await clienteApi.ingerirQr({
      qrPayload: cupom.qrPayload,
      capturadoEm: cupom.capturadoEm,
    });
    await vincularUpload(cupom.id, resp);
    await fila.removerDaFila(item.cupomLocalId);
  } catch (erro) {
    if (ehPermanente(erro)) {
      await cupons.atualizarStatus(cupom.id, 'falha');
      await fila.removerDaFila(item.cupomLocalId);
      return;
    }
    const motivo = erro instanceof Error ? erro.message : String(erro);
    await fila.registrarFalha(cupom.id, motivo, atrasoBackoff(item.tentativas));
  }
}

/** Drena a fila de upload (cupons prontos para tentar agora). */
export async function processarFilaUpload(): Promise<void> {
  const pendentes = await fila.listarPendentes();
  for (const item of pendentes) {
    await enviarCupom(item);
  }
}

/** Grava no espelho local o cupom já processado que o backend devolveu (C6.3). */
async function aplicarCupomRemoto(cupomLocalId: string, remoto: CupomResponse): Promise<void> {
  const lojaNome = remoto.loja?.nomeFantasia ?? remoto.loja?.razaoSocial;
  await cupons.aplicarProcessamento(cupomLocalId, {
    cupomIdServidor: remoto.cupomId,
    status: remoto.status,
    ...(remoto.loja?.cnpj ? { lojaCnpj: remoto.loja.cnpj } : {}),
    ...(lojaNome ? { lojaNome } : {}),
    ...(remoto.loja?.municipio ? { lojaMunicipio: remoto.loja.municipio } : {}),
    ...(remoto.emitidoEm ? { emitidoEm: remoto.emitidoEm } : {}),
    ...(remoto.uf ? { uf: remoto.uf } : {}),
    ...(remoto.descontoTotal != null ? { descontoTotal: remoto.descontoTotal } : {}),
    ...(remoto.valorPago != null ? { valorPago: remoto.valorPago } : {}),
    itens: remoto.itens.map((i) => ({
      produtoCanonicoId: i.produtoCanonicoId ?? null,
      descricaoOriginal: i.descricaoOriginal,
      ean: i.ean ?? null,
      quantidade: i.quantidade,
      unidade: i.unidade,
      valorUnitario: i.valorUnitario,
      valorTotal: i.valorTotal,
      desconto: i.desconto ?? null,
      // Congelado pelo backend no processamento — o app só espelha, nunca
      // recalcula (senão o número do passado mudaria a cada sync).
      tipicoNaCompra: i.tipicoNaCompra ?? null,
    })),
  });
}

/** Aplica o resultado do parsing de UM cupom já no servidor, se já terminou. */
async function buscarProcessamento(cupom: CupomLocal): Promise<void> {
  if (!cupom.cupomIdServidor) return;
  const remoto = await clienteApi.obterCupom(cupom.cupomIdServidor);
  if (!remoto) return; // ainda na fila do backend, ou 404 transitório.
  if (remoto.status === 'qr_capturado') return; // parsing ainda não concluiu.
  await aplicarCupomRemoto(cupom.id, remoto);
}

/** Consulta o backend pelos cupons enviados mas ainda sem parsing concluído. */
export async function atualizarProcessamentos(): Promise<void> {
  const aguardando = await cupons.listarAguardandoProcessamento();
  for (const cupom of aguardando) {
    try {
      await buscarProcessamento(cupom);
      limparFalhas('sync.processamento');
    } catch (erro) {
      // Antes era um `catch {}` mudo: um bug PERMANENTE (contrato quebrado, 400
      // do servidor) ficava indistinguível de "está offline", para sempre. O
      // contador separa os dois — offline passa, bug se acumula.
      contarFalha('sync.processamento', erro);
    }
  }
}

/**
 * C7.2 — Delta sync das estatísticas regionais para o cache offline. Baixa só o
 * que mudou desde o cursor, no recorte dos produtos do histórico + os da lista
 * de compras (C7.7) + a região do usuário (município + UF de fallback, derivados
 * da localização escolhida ou da LOJA — nunca do usuário). É o que faz o
 * veredito da gôndola funcionar sem sinal. Best-effort e idempotente (cursor por
 * `atualizado_em`).
 */
export async function sincronizarEstatisticas(): Promise<void> {
  const [doHistorico, daLista, local, cursorInicial, escoposAnteriores] = await Promise.all([
    produtos.listarProdutoCanonicoIds(),
    // C7.7 — a lista de compras também define o recorte: produto que veio do
    // catálogo regional (C7.6) e nunca foi comprado não está no histórico, e sem
    // isto ficaria para sempre sem típico offline.
    lista.listarProdutoCanonicoIds(),
    resolverLocalizacao(),
    meta.obterCursorDelta(),
    meta.obterEscoposSync(),
  ]);
  const produtoCanonicoIds = [...new Set([...doHistorico, ...daLista])];
  // Sem produtos no histórico e sem região conhecida: nada a sincronizar ainda.
  if (produtoCanonicoIds.length === 0 && !local) return;

  const municipios = local ? escoposSync(local) : [];

  // C7.7 — recuperação dos produtos NOVOS no recorte. O cursor avança sobre o
  // que foi entregue, então um produto que entra depois (item que veio do
  // catálogo regional, C7.6) tem estatística mais ANTIGA que o cursor e o delta
  // incremental jamais a traria. Estes vêm numa busca própria, sem cursor.
  // Isolado: uma falha aqui não pode impedir o delta principal da rodada — os
  // ids ficam sem marca e a próxima rodada tenta de novo.
  try {
    await recuperarSemCache(produtoCanonicoIds, municipios);
    limparFalhas('sync.recuperacao');
  } catch (erro) {
    contarFalha('sync.recuperacao', erro);
  }

  // O cursor só percorreu os escopos da rodada anterior. Quando entra uma chave
  // NOVA — tipicamente o município, que passa a ser conhecido depois do primeiro
  // cupom processado — as linhas dela mais antigas que o cursor nunca chegariam
  // pelo delta incremental, e o app ficaria preso no típico de UF mesmo tendo
  // município. Recomeçar a janela resolve; o cache NÃO é limpo porque o que já
  // está lá continua válido (`salvarEstatisticas` é upsert por chave).
  const assinatura = meta.assinaturaEscopos(municipios);
  let cursor = assinatura === escoposAnteriores ? cursorInicial : null;

  // O servidor tem teto de linhas por resposta e sinaliza `temMais` quando a
  // página encheu. Repaginar AQUI é o que garante que uma janela grande (região
  // nova, primeiro sync, longo tempo offline) entre no cache de uma vez — antes,
  // o excedente ficava para as próximas rodadas, sem ninguém saber.
  for (let pagina = 0; pagina < MAX_PAGINAS_DELTA; pagina++) {
    const resp = await clienteApi.sincronizar({
      ...(cursor ? { cursor } : {}),
      ...(municipios.length > 0 ? { municipios } : {}),
      ...(produtoCanonicoIds.length > 0 ? { produtoCanonicoIds } : {}),
    });
    await cache.salvarEstatisticas(resp.estatisticas);
    // Grava o cursor a cada página: se a próxima falhar (sinal caiu), a rodada
    // seguinte retoma daqui em vez de refazer tudo.
    await meta.definirCursorDelta(resp.cursor);
    // Junto com o primeiro cursor da janela: daqui em diante ele cobre estes
    // escopos. Se a rodada cair no meio, a próxima retoma pelo cursor gravado.
    if (pagina === 0) await meta.definirEscoposSync(municipios);
    cursor = resp.cursor;
    // Só `temMais` decide continuar: o servidor o marca quando a página CRUA
    // encheu, e uma página inteira pode voltar vazia depois da supressão de
    // célula pequena (docs/04) sem que o delta tenha acabado. Parar por
    // `estatisticas.length === 0` deixaria o resto da janela para a próxima
    // rodada. Página não-cheia (`!temMais`) já cobre o caso "nada mudou".
    if (!resp.temMais) return;
  }
}

/**
 * Baixa TUDO (sem cursor) dos produtos do recorte que ainda não têm nada em
 * cache. Não mexe no cursor persistido: este é um recorte lateral, e adiantá-lo
 * com o resultado daqui pularia o que o delta principal ainda deve entregar.
 * Idempotente — `salvarEstatisticas` é upsert por chave.
 */
async function recuperarSemCache(
  produtoCanonicoIds: readonly string[],
  municipios: readonly string[],
): Promise<void> {
  const [semCache, jaTentados] = await Promise.all([
    cache.idsSemEstatistica(produtoCanonicoIds),
    meta.obterIdsRecuperados(),
  ]);
  const tentados = new Set(jaTentados);
  const novos = semCache.filter((id) => !tentados.has(id));
  if (novos.length === 0) return;

  let cursor: string | undefined;
  for (let pagina = 0; pagina < MAX_PAGINAS_DELTA; pagina++) {
    const resp = await clienteApi.sincronizar({
      ...(cursor ? { cursor } : {}),
      ...(municipios.length > 0 ? { municipios: [...municipios] } : {}),
      produtoCanonicoIds: novos,
    });
    await cache.salvarEstatisticas(resp.estatisticas);
    if (!resp.temMais) break;
    cursor = resp.cursor;
  }

  // Só marca depois de concluir: uma queda de sinal no meio lança antes daqui, e
  // a próxima rodada tenta de novo em vez de dar o produto por perdido.
  await meta.definirIdsRecuperados([...tentados, ...novos]);
}

/** Página do restore e teto de segurança de páginas por rodada. */
const LIMITE_RESTORE_PAGINA = 50;
const MAX_PAGINAS_RESTORE = 200;

/** Traduz um cupom do histórico (DTO) para a forma do espelho local. */
function paraRestaurado(h: HistoricoCupom): CupomRestaurado {
  return {
    cupomIdServidor: h.cupomId,
    status: h.status,
    qrPayload: h.qrPayload,
    chaveAcesso: h.chaveAcesso ?? null,
    capturadoEm: h.capturadoEm,
    emitidoEm: h.emitidoEm ?? null,
    uf: h.uf ?? null,
    lojaCnpj: h.loja?.cnpj ?? null,
    // Mesma preferência do processamento: nome fantasia, senão razão social.
    lojaNome: h.loja?.nomeFantasia ?? h.loja?.razaoSocial ?? null,
    // Município da loja: é aqui que os cupons anteriores à v8 ganham a cidade.
    lojaMunicipio: h.loja?.municipio ?? null,
    descontoTotal: h.descontoTotal ?? null,
    valorPago: h.valorPago ?? null,
    itens: h.itens.map((i) => ({
      produtoCanonicoId: i.produtoCanonicoId ?? null,
      descricaoOriginal: i.descricaoOriginal,
      ean: i.ean ?? null,
      quantidade: i.quantidade,
      unidade: i.unidade,
      valorUnitario: i.valorUnitario,
      valorTotal: i.valorTotal,
      desconto: i.desconto ?? null,
      // Congelado pelo backend no processamento — o app só espelha, nunca
      // recalcula (senão o número do passado mudaria a cada sync).
      tipicoNaCompra: i.tipicoNaCompra ?? null,
    })),
  };
}

/**
 * Rehidratação do histórico privado no login (restore, docs/04). Ao SAIR, o app
 * limpa o espelho local; o histórico continua guardado na conta, no servidor.
 * Aqui ele volta, paginado, para o app reconstruir o histórico — no mesmo
 * aparelho, num novo, ou após reinstalar.
 *
 * Roda UMA vez por sessão (flag em `meta_sync`, que o logout apaga): a flag só é
 * marcada ao chegar ao fim da paginação, então uma queda de sinal no meio faz a
 * próxima rodada recomeçar — sem duplicar, porque `restaurarCupons` é idempotente
 * (pula quem já existe). Requer sessão; 401 sobe como erro transitório e a rodada
 * seguinte tenta de novo.
 */
export async function restaurarHistorico(): Promise<void> {
  if (await meta.historicoRestaurado()) return;

  let cursor: string | undefined;
  for (let pagina = 0; pagina < MAX_PAGINAS_RESTORE; pagina++) {
    const resp = await clienteApi.listarHistorico(cursor, LIMITE_RESTORE_PAGINA);
    if (resp.cupons.length > 0) {
      await cupons.restaurarCupons(resp.cupons.map(paraRestaurado));
    }
    if (!resp.proximoCursor) {
      await meta.marcarHistoricoRestaurado();
      return;
    }
    cursor = resp.proximoCursor;
  }
  // Estourou o teto (histórico gigante): o essencial já veio. Marca como
  // concluído para não repaginar tudo a cada rodada — o resto é raríssimo.
  await meta.marcarHistoricoRestaurado();
}

/**
 * Rodada completa de sincronização (upload + processamento + restore +
 * estatísticas). Chamada no boot, ao voltar para o app (foreground) e após uma
 * captura. Engole erros — é best-effort.
 */
export async function sincronizar(): Promise<void> {
  if (rodando) return;
  rodando = true;
  const inicio = Date.now();
  try {
    await processarFilaUpload();
    await atualizarProcessamentos();
    // Restore ANTES das estatísticas: os produtos reidratados entram no recorte
    // do delta sync, e o veredito da gôndola volta a funcionar para eles.
    try {
      await restaurarHistorico();
      limparFalhas('sync.restore');
    } catch (erro) {
      contarFalha('sync.restore', erro);
    }
    // Estatísticas num passo isolado: uma falha aqui não desfaz o upload/parsing.
    try {
      await sincronizarEstatisticas();
      limparFalhas('sync.estatisticas');
    } catch (erro) {
      contarFalha('sync.estatisticas', erro);
    }
    limparFalhas('sync.rodada');
    log.info({ action: 'sync.rodada', duracaoMs: Date.now() - inicio }, 'Rodada de sync concluída');
  } catch (erro) {
    // Best-effort: a próxima rodada retoma de onde parou (estado está no
    // SQLite). Mas agora deixa rastro — este era o `catch {}` que fazia o app
    // parecer normal enquanto o upload nunca acontecia.
    contarFalha('sync.rodada', erro);
  } finally {
    rodando = false;
  }
}

/**
 * Sincroniza UM cupom e devolve seu estado local atualizado (C6.3). A tela Nota
 * fiscal usa isto em polling: envia se ainda não subiu, busca o parsing e aplica.
 * Propaga `ErroApi` para a tela distinguir "offline" de "processando".
 */
export async function sincronizarCupom(cupomLocalId: string): Promise<CupomLocal | null> {
  let cupom = await cupons.obterCupom(cupomLocalId);
  if (!cupom) return null;

  if (!cupom.cupomIdServidor) {
    const resp = await clienteApi.ingerirQr({
      qrPayload: cupom.qrPayload,
      capturadoEm: cupom.capturadoEm,
    });
    await vincularUpload(cupom.id, resp);
    await fila.removerDaFila(cupom.id);
    cupom = (await cupons.obterCupom(cupomLocalId)) ?? cupom;
  }

  if (cupom.status === 'qr_capturado' && cupom.cupomIdServidor) {
    await buscarProcessamento(cupom);
    cupom = (await cupons.obterCupom(cupomLocalId)) ?? cupom;
  }

  return cupom;
}

/**
 * C2.6 — Captura por HTML. Quando o portal exige navegador/reCAPTCHA (ex.: RJ) e
 * o backend não alcança a nota, o app abre a URL do QR num WebView, colhe o HTML
 * renderizado e o envia aqui. Sobe o cupom antes, se ainda não subiu, e aplica o
 * resultado ao espelho local. Propaga `ErroApi` (a tela distingue 422 = "HTML
 * ainda é a página de desafio, tentar de novo" de erro real).
 */
export async function enviarHtmlCupom(
  cupomLocalId: string,
  html: string,
): Promise<CupomLocal | null> {
  let cupom = await cupons.obterCupom(cupomLocalId);
  if (!cupom) return null;

  if (!cupom.cupomIdServidor) {
    const resp = await clienteApi.ingerirQr({
      qrPayload: cupom.qrPayload,
      capturadoEm: cupom.capturadoEm,
    });
    await vincularUpload(cupom.id, resp);
    await fila.removerDaFila(cupom.id);
    cupom = (await cupons.obterCupom(cupomLocalId)) ?? cupom;
  }
  if (!cupom.cupomIdServidor) return cupom;

  const remoto = await clienteApi.ingerirHtmlCupom(cupom.cupomIdServidor, html);
  if (remoto.status !== 'qr_capturado') {
    await aplicarCupomRemoto(cupom.id, remoto);
  }
  return (await cupons.obterCupom(cupomLocalId)) ?? cupom;
}
