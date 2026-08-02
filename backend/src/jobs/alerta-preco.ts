/**
 * C8.4 — Job de push de alerta de preço. Roda por scheduler externo (GitHub
 * Actions cron em `.github/workflows/alerta-preco.yml`, logo após o recálculo
 * de estatística):
 *   npm run job:alerta-preco   (workspace @barganha/backend)
 *
 * O que faz, em ordem:
 *  1. Lê `alerta_preco` (espelho PRIVADO do alerta local) + `preco_estatistica`
 *     (SELECT PURO — este job nunca escreve na estatística; ela é o pool
 *     compartilhado e o job só a CONSOME, como o app faz localmente).
 *  2. Decide, por alvo, DISPARAR (preço cruzou e ainda não havia disparado) ou
 *     REARMAR (já havia disparado e o preço voltou a subir 5% acima do alvo —
 *     histerese contra ping-pong de push) usando a MESMA regra do app
 *     (`escolherEstatisticaRegional`/`avaliarAlerta` em `@barganha/shared`).
 *  3. Envia os disparos via Expo Push em lote (`expo-server-sdk`), trata
 *     `DeviceNotRegistered` apagando o token, e só ENTÃO persiste
 *     `disparado_em` — sem sucesso de envio, o alvo permanece elegível na
 *     próxima rodada (retry natural, sem contador extra).
 *  4. Aplica a RETENÇÃO do token de push (LGPD, docs/04): carimba `visto_em`
 *     em todo token que recebeu entrega e APAGA os que estão sem sinal de vida
 *     há mais de 90 dias. O token é identificador de DISPOSITIVO — guardá-lo
 *     "para sempre" não tem base na finalidade (avisar quem ainda usa o app).
 *     O aparelho ativo re-carimba `visto_em` sozinho, sem push nenhum, porque
 *     o registro do token (`POST /dispositivos/push`, chamado toda vez que o
 *     app confere a permissão concedida) também o atualiza — então a purga só
 *     alcança aparelho que sumiu de verdade.
 *
 * `escopo_geo` em `alerta_preco` é uma chave ÚNICA (município `UF:MUNICIPIO`
 * ou UF nua) resolvida no momento em que o alerta foi definido — não os DOIS
 * níveis que `escolherEstatisticaRegional` compara. Para reproduzir o mesmo
 * fallback município→UF que o app faz localmente, `localDeEscopoGeo` desmonta
 * essa chave de volta em `{ uf, municipio }` e o job busca AMBOS os níveis de
 * `preco_estatistica` para o produto — assim, se o município esfriar (poucas
 * observações) depois que o alerta foi criado, o job ainda cai para a UF, como
 * o app cairia.
 */

import { fileURLToPath } from 'node:url';

import {
  type AlertaDisparado,
  avaliarAlerta,
  type EstatisticaRegional,
  escolherEstatisticaRegional,
} from '@barganha/shared';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';

import { montarBackend } from '../composicao';
import { lerConfig } from '../config/env';
import { logDeJob } from '../observabilidade/log';
import { sanitizarErro, sanitizarErroInesperado } from '../observabilidade/sanitizar';
import type { criarClienteSupabase } from '../persistencia/supabase';
import type { ServicoAlertas } from '../servicos/servico-alertas';

/** Acima de `precoAlvo * FATOR_REARME`, um alvo já disparado é rearmado. */
const FATOR_REARME = 1.05;
/**
 * Retenção do token de push (docs/04): sem sinal de vida há mais de 90 dias, o
 * token é apagado. Um aparelho que voltar a abrir o app se registra de novo.
 */
const DIAS_TTL_TOKEN = 90;
/** Página das varreduras — mesmo teto do `max_rows` do PostgREST (ver repositorio-supabase.ts). */
const PAGINA = 1000;

// ─────────────────────────── Núcleo puro (testável) ───────────────────────

/** Uma linha de `alerta_preco`, já com o nome de exibição do produto anexado. */
export interface AlertaPrecoLinha {
  usuarioId: string;
  produtoCanonicoId: string;
  nome: string;
  precoAlvo: number;
  escopoGeo: string;
  disparadoEm: string | null;
}

export interface DisparoPendente {
  usuarioId: string;
  produtoCanonicoId: string;
  disparo: AlertaDisparado;
}

export interface RearmoPendente {
  usuarioId: string;
  produtoCanonicoId: string;
}

export interface DecisaoAlertasPreco {
  disparar: DisparoPendente[];
  rearmar: RearmoPendente[];
}

/**
 * Desmonta `escopo_geo` (`chaveMunicipio()`: `"UF:MUNICIPIO"`, ou UF nua) de
 * volta em `{ uf, municipio }` — o formato que `escolherEstatisticaRegional`
 * espera. `municipio` normalizado é idempotente por `chaveMunicipio` (ver
 * `estatistica/normalizacao.ts`), então reconstruir e recompor bate com a
 * chave original.
 */
export function localDeEscopoGeo(escopoGeo: string): { uf: string; municipio?: string } {
  const idx = escopoGeo.indexOf(':');
  if (idx === -1) return { uf: escopoGeo };
  return { uf: escopoGeo.slice(0, idx), municipio: escopoGeo.slice(idx + 1) };
}

/**
 * Núcleo testável: decide, para cada alerta, disparar / rearmar / nada, dado o
 * conjunto de `preco_estatistica` (município + UF) já carregado por produto.
 * Sem I/O próprio.
 */
export function avaliarAlertasPreco(
  alertas: readonly AlertaPrecoLinha[],
  estatisticasPorProduto: ReadonlyMap<string, readonly EstatisticaRegional[]>,
  referencia: Date = new Date(),
): DecisaoAlertasPreco {
  const disparar: DisparoPendente[] = [];
  const rearmar: RearmoPendente[] = [];

  for (const alerta of alertas) {
    const candidatos = estatisticasPorProduto.get(alerta.produtoCanonicoId) ?? [];
    const local = localDeEscopoGeo(alerta.escopoGeo);
    const regional = escolherEstatisticaRegional(candidatos, local);

    if (alerta.disparadoEm == null) {
      const disparo = avaliarAlerta(
        {
          produtoCanonicoId: alerta.produtoCanonicoId,
          nome: alerta.nome,
          precoAlvo: alerta.precoAlvo,
        },
        regional,
        referencia,
      );
      if (disparo) {
        disparar.push({
          usuarioId: alerta.usuarioId,
          produtoCanonicoId: alerta.produtoCanonicoId,
          disparo,
        });
      }
      continue;
    }

    // Já disparado: rearma quando o preço voltou a subir acima da histerese —
    // não exige frescor (rearmar é sempre seguro; o PRÓXIMO disparo, sim, exige).
    const referenciaPreco = regional?.mediana ?? undefined;
    if (referenciaPreco != null && referenciaPreco > alerta.precoAlvo * FATOR_REARME) {
      rearmar.push({ usuarioId: alerta.usuarioId, produtoCanonicoId: alerta.produtoCanonicoId });
    }
  }

  return { disparar, rearmar };
}

// ────────────────────────────── Wiring (Supabase + Expo) ──────────────────

type Db = ReturnType<typeof criarClienteSupabase>;

/** Varre uma consulta paginada (teto do PostgREST) até a página vir incompleta. */
async function buscarTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  contexto: string,
): Promise<T[]> {
  const acumulado: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const r = await pagina(de, de + PAGINA - 1);
    if (r.error) throw new Error(`Falha ao ler ${contexto}: ${r.error.message}`);
    const lote = r.data ?? [];
    acumulado.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return acumulado;
}

interface LinhaAlertaBanco {
  usuario_id: string;
  produto_canonico_id: string;
  preco_alvo: string | number;
  escopo_geo: string;
  disparado_em: string | null;
}

interface LinhaEstatisticaBanco {
  produto_canonico_id: string;
  escopo: EstatisticaRegional['escopo'];
  escopo_id: string;
  unidade_base: EstatisticaRegional['unidadeBase'];
  mediana: number | null;
  p25: number | null;
  p75: number | null;
  minimo: number | null;
  maximo: number | null;
  menor_promocional: number | null;
  n_observacoes: number;
  observado_em_max: string | null;
  atualizado_em: string;
}

/** Carrega os alertas + as estatísticas candidatas (município e UF) por produto. */
async function carregarEstado(db: Db): Promise<{
  linhas: AlertaPrecoLinha[];
  estatisticasPorProduto: Map<string, EstatisticaRegional[]>;
}> {
  const alertasBanco = await buscarTudo<LinhaAlertaBanco>(
    (de, ate) =>
      db
        .from('alerta_preco')
        .select('usuario_id, produto_canonico_id, preco_alvo, escopo_geo, disparado_em')
        .range(de, ate),
    'alerta_preco',
  );

  if (alertasBanco.length === 0) {
    return { linhas: [], estatisticasPorProduto: new Map() };
  }

  const produtoIds = [...new Set(alertasBanco.map((a) => a.produto_canonico_id))];

  const [produtos, estatisticasBanco] = await Promise.all([
    buscarTudo<{ id: string; nome_exibicao: string | null; descricao_normalizada: string | null }>(
      (de, ate) =>
        db
          .from('produto_canonico')
          .select('id, nome_exibicao, descricao_normalizada')
          .in('id', produtoIds)
          .range(de, ate),
      'produto_canonico',
    ),
    buscarTudo<LinhaEstatisticaBanco>(
      (de, ate) =>
        db
          .from('preco_estatistica')
          .select(
            'produto_canonico_id, escopo, escopo_id, unidade_base, mediana, p25, p75, minimo, maximo, menor_promocional, n_observacoes, observado_em_max, atualizado_em',
          )
          .in('produto_canonico_id', produtoIds)
          .in('escopo', ['municipio', 'uf'])
          .range(de, ate),
      'preco_estatistica',
    ),
  ]);

  const nomePorProduto = new Map(
    produtos.map((p) => [p.id, p.nome_exibicao ?? p.descricao_normalizada ?? 'Produto']),
  );

  const linhas: AlertaPrecoLinha[] = alertasBanco.map((a) => ({
    usuarioId: a.usuario_id,
    produtoCanonicoId: a.produto_canonico_id,
    nome: nomePorProduto.get(a.produto_canonico_id) ?? 'Produto',
    precoAlvo: Number(a.preco_alvo),
    escopoGeo: a.escopo_geo,
    disparadoEm: a.disparado_em,
  }));

  const estatisticasPorProduto = new Map<string, EstatisticaRegional[]>();
  for (const e of estatisticasBanco) {
    const linha: EstatisticaRegional = {
      produtoCanonicoId: e.produto_canonico_id,
      escopo: e.escopo,
      escopoId: e.escopo_id,
      unidadeBase: e.unidade_base,
      mediana: e.mediana != null ? Number(e.mediana) : null,
      p25: e.p25 != null ? Number(e.p25) : null,
      p75: e.p75 != null ? Number(e.p75) : null,
      minimo: e.minimo != null ? Number(e.minimo) : null,
      maximo: e.maximo != null ? Number(e.maximo) : null,
      menorPromocional: e.menor_promocional != null ? Number(e.menor_promocional) : null,
      nObservacoes: e.n_observacoes,
      observadoEmMaisRecente: e.observado_em_max,
      atualizadoEm: e.atualizado_em,
    };
    const lista = estatisticasPorProduto.get(e.produto_canonico_id) ?? [];
    lista.push(linha);
    estatisticasPorProduto.set(e.produto_canonico_id, lista);
  }

  return { linhas, estatisticasPorProduto };
}

/** Rearma: zera `disparado_em` e carimba `rearmado_em` — um `update` por alvo. */
async function aplicarRearmes(db: Db, rearmar: readonly RearmoPendente[]): Promise<void> {
  const agora = new Date().toISOString();
  for (const r of rearmar) {
    const res = await db
      .from('alerta_preco')
      .update({ disparado_em: null, rearmado_em: agora })
      .eq('usuario_id', r.usuarioId)
      .eq('produto_canonico_id', r.produtoCanonicoId);
    if (res.error) throw new Error(`Falha ao rearmar alerta: ${res.error.message}`);
  }
}

interface EnvioPendente {
  usuarioId: string;
  produtoCanonicoId: string;
  token: string;
}

function corpoDoDisparo(d: AlertaDisparado): string {
  const preco = d.mediana ?? d.menorVisto ?? d.precoAlvo;
  return `${d.nome} chegou a R$ ${preco.toFixed(2)} na sua região.`;
}

/**
 * Envia os disparos via Expo Push. Devolve os pares (usuário, produto) que
 * tiveram AO MENOS UM envio bem-sucedido — só esses persistem `disparado_em`
 * (sem sucesso de entrega, o alvo permanece elegível na próxima rodada) — e os
 * tokens que aceitaram a entrega, para carimbar `visto_em` (base do TTL).
 * Tokens com ticket `DeviceNotRegistered` são removidos via `servicoAlertas`.
 */
async function enviarDisparos(
  expo: Expo,
  servicoAlertas: ServicoAlertas,
  disparar: readonly DisparoPendente[],
  tokensPorUsuario: ReadonlyMap<string, readonly string[]>,
  log: ReturnType<typeof logDeJob>,
): Promise<{ chaves: Set<string>; tokensVivos: Set<string> }> {
  const envios: EnvioPendente[] = [];
  const mensagens: ExpoPushMessage[] = [];
  for (const d of disparar) {
    for (const token of tokensPorUsuario.get(d.usuarioId) ?? []) {
      if (!Expo.isExpoPushToken(token)) continue; // token corrompido — ignora, não quebra o lote
      envios.push({ usuarioId: d.usuarioId, produtoCanonicoId: d.produtoCanonicoId, token });
      mensagens.push({
        to: token,
        title: 'Preço baixou',
        body: corpoDoDisparo(d.disparo),
        data: { produtoCanonicoId: d.produtoCanonicoId },
      });
    }
  }

  const sucesso = new Set<string>();
  const tokensVivos = new Set<string>();
  if (mensagens.length === 0) return { chaves: sucesso, tokensVivos };

  const chunks = expo.chunkPushNotifications(mensagens);
  let cursor = 0;
  for (const chunk of chunks) {
    const subset = envios.slice(cursor, cursor + chunk.length);
    cursor += chunk.length;

    let tickets: ExpoPushTicket[];
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (erro) {
      // Falha de rede/HTTP do lote inteiro: os alvos deste chunk não avançam —
      // `disparado_em` continua null e a PRÓXIMA rodada tenta de novo.
      log.warn(
        { action: 'alerta_preco.chunk_falhou', erro: sanitizarErro(erro) },
        'Falha ao enviar lote de push — retry na próxima rodada',
      );
      continue;
    }

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const envio = subset[i];
      if (!ticket || !envio) continue;
      if (ticket.status === 'ok') {
        sucesso.add(`${envio.usuarioId} ${envio.produtoCanonicoId}`);
        tokensVivos.add(envio.token);
      } else if (ticket.details?.error === 'DeviceNotRegistered') {
        // Escopado ao dono: se o aparelho trocou de conta entre a leitura e o
        // envio, o token do outro usuário não é apagado por engano.
        await servicoAlertas.removerDispositivo(envio.token, envio.usuarioId);
        log.info(
          { action: 'alerta_preco.token_removido', usuarioId: envio.usuarioId },
          'Token de push inválido removido (DeviceNotRegistered)',
        );
      }
    }
  }
  return { chaves: sucesso, tokensVivos };
}

/**
 * Retenção do token de push (LGPD, docs/04). Duas metades da MESMA regra:
 *  • carimba `visto_em` em quem acabou de receber entrega (sinal de vida);
 *  • apaga quem está sem sinal de vida há mais de `DIAS_TTL_TOKEN`.
 *
 * `criado_em` cobre a linha antiga que nunca recebeu push nem re-registro (o
 * registro do token passou a carimbar `visto_em`, mas não retroage). Sem esta
 * segunda metade, um aparelho trocado/abandonado deixaria um identificador de
 * dispositivo guardado para sempre — sem finalidade que o justifique.
 */
async function aplicarRetencaoTokens(
  db: Db,
  tokensVivos: ReadonlySet<string>,
  log: ReturnType<typeof logDeJob>,
): Promise<void> {
  const agora = new Date();
  if (tokensVivos.size > 0) {
    const res = await db
      .from('dispositivo_push')
      .update({ visto_em: agora.toISOString() })
      .in('token', [...tokensVivos]);
    if (res.error) throw new Error(`Falha ao carimbar visto_em: ${res.error.message}`);
  }

  const limite = new Date(agora.getTime() - DIAS_TTL_TOKEN * 86_400_000).toISOString();
  const expirados = await db
    .from('dispositivo_push')
    .delete()
    // Valores entre aspas: o timestamp ISO tem `:`/`.`/`-`, que o parser de
    // filtro do PostgREST leria como separador se fossem nus.
    .or(`visto_em.lt."${limite}",and(visto_em.is.null,criado_em.lt."${limite}")`)
    .select('token');
  if (expirados.error) throw new Error(`Falha na purga de tokens: ${expirados.error.message}`);

  const purgados = expirados.data?.length ?? 0;
  if (purgados > 0) {
    // Nunca logamos o token em si — é identificador de dispositivo.
    log.info({ action: 'alerta_preco.tokens_purgados', purgados }, 'Tokens de push expirados (TTL)');
  }
}

async function persistirDisparados(db: Db, chavesSucesso: ReadonlySet<string>): Promise<void> {
  const agora = new Date().toISOString();
  for (const chave of chavesSucesso) {
    const [usuarioId, produtoCanonicoId] = chave.split(' ');
    const res = await db
      .from('alerta_preco')
      .update({ disparado_em: agora })
      .eq('usuario_id', usuarioId as string)
      .eq('produto_canonico_id', produtoCanonicoId as string);
    if (res.error) throw new Error(`Falha ao persistir disparo: ${res.error.message}`);
  }
}

export async function main(): Promise<void> {
  const log = logDeJob('alerta-preco');
  const config = lerConfig();
  const { db, servicoAlertas } = montarBackend(config);

  const { linhas, estatisticasPorProduto } = await carregarEstado(db);
  if (linhas.length === 0) {
    // A retenção do token NÃO depende de existir alerta: aparelho sem alvo
    // nenhum também não pode manter um identificador guardado para sempre.
    await aplicarRetencaoTokens(db, new Set(), log);
    log.info({ action: 'alerta_preco.sem_alertas' }, 'Nenhum alerta de preço cadastrado');
    return;
  }

  const decisao = avaliarAlertasPreco(linhas, estatisticasPorProduto);

  await aplicarRearmes(db, decisao.rearmar);

  const usuarioIds = [...new Set(decisao.disparar.map((d) => d.usuarioId))];
  const tokensPorUsuario = new Map<string, string[]>();
  if (usuarioIds.length > 0) {
    const dispositivos = await buscarTudo<{ usuario_id: string; token: string }>(
      (de, ate) =>
        db.from('dispositivo_push').select('usuario_id, token').in('usuario_id', usuarioIds).range(de, ate),
      'dispositivo_push',
    );
    for (const d of dispositivos) {
      const lista = tokensPorUsuario.get(d.usuario_id) ?? [];
      lista.push(d.token);
      tokensPorUsuario.set(d.usuario_id, lista);
    }
  }

  const expo = new Expo();
  const { chaves, tokensVivos } = await enviarDisparos(
    expo,
    servicoAlertas,
    decisao.disparar,
    tokensPorUsuario,
    log,
  );
  await persistirDisparados(db, chaves);
  await aplicarRetencaoTokens(db, tokensVivos, log);

  log.info(
    {
      action: 'alerta_preco.concluido',
      alertasAvaliados: linhas.length,
      disparosDecididos: decisao.disparar.length,
      pushesEnviados: chaves.size,
      rearmados: decisao.rearmar.length,
    },
    'Rodada de alerta de preço concluída',
  );
}

// Executado direto (não quando importado por um teste).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((erro) => {
    // Catch-all do job — com pilha (C10.4), ver nota em `recalculo-estatistica`.
    logDeJob('alerta-preco').fatal({ erro: sanitizarErroInesperado(erro) }, 'Job de alerta de preço falhou');
    process.exitCode = 1;
  });
}
