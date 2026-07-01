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

import type { CupomResponse } from '@barganha/shared';

import { clienteApi, ErroApi } from '@/api';
import { cache, cupons, fila, meta, produtos } from '@/dados';
import type { CupomLocal, ItemFilaUpload } from '@/dados';

/** Backoff: 15s, 30s, 1min… até o teto de 1h. */
const BACKOFF_BASE_S = 15;
const BACKOFF_MAX_S = 60 * 60;

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
    await cupons.vincularServidor(cupom.id, resp.cupomId, resp.status);
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
    ...(remoto.emitidoEm ? { emitidoEm: remoto.emitidoEm } : {}),
    ...(remoto.uf ? { uf: remoto.uf } : {}),
    itens: remoto.itens.map((i) => ({
      produtoCanonicoId: i.produtoCanonicoId ?? null,
      descricaoOriginal: i.descricaoOriginal,
      ean: i.ean ?? null,
      quantidade: i.quantidade,
      unidade: i.unidade,
      valorUnitario: i.valorUnitario,
      valorTotal: i.valorTotal,
      desconto: i.desconto ?? null,
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
    } catch {
      // Offline/servidor fora — tenta de novo na próxima rodada.
    }
  }
}

/**
 * C7.2 — Delta sync das estatísticas regionais para o cache offline. Baixa só o
 * que mudou desde o cursor, no recorte dos produtos do histórico + a UF do
 * usuário (derivada da LOJA, nunca do usuário). É o que faz o veredito da
 * gôndola funcionar sem sinal. Best-effort e idempotente (cursor por
 * `atualizado_em`).
 */
export async function sincronizarEstatisticas(): Promise<void> {
  const [produtoCanonicoIds, uf, cursor] = await Promise.all([
    produtos.listarProdutoCanonicoIds(),
    produtos.obterUfRecente(),
    meta.obterCursorDelta(),
  ]);
  // Sem produtos no histórico e sem região conhecida: nada a sincronizar ainda.
  if (produtoCanonicoIds.length === 0 && !uf) return;

  const resp = await clienteApi.sincronizar({
    ...(cursor ? { cursor } : {}),
    ...(uf ? { municipios: [uf] } : {}),
    ...(produtoCanonicoIds.length > 0 ? { produtoCanonicoIds } : {}),
  });
  await cache.salvarEstatisticas(resp.estatisticas);
  await meta.definirCursorDelta(resp.cursor);
}

/**
 * Rodada completa de sincronização (upload + processamento + estatísticas).
 * Chamada no boot, ao voltar para o app (foreground) e após uma captura. Engole
 * erros — é best-effort.
 */
export async function sincronizar(): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    await processarFilaUpload();
    await atualizarProcessamentos();
    // Estatísticas num passo isolado: uma falha aqui não desfaz o upload/parsing.
    try {
      await sincronizarEstatisticas();
    } catch {
      // Offline/servidor fora — retoma do cursor na próxima rodada.
    }
  } catch {
    // Best-effort: a próxima rodada retoma de onde parou (estado está no SQLite).
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
    await cupons.vincularServidor(cupom.id, resp.cupomId, resp.status);
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
    await cupons.vincularServidor(cupom.id, resp.cupomId, resp.status);
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
