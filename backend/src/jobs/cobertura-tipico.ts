/**
 * C8.4.1 — Job de MEDIÇÃO da cobertura do "típico na compra".
 *
 * Por que existe: `item_cupom.tipico_mediana` é gravado desde
 * `20260725090000_item_cupom_tipico_na_compra.sql`, mas ninguém consulta a
 * fração de itens preenchidos. A UI de "economia real" (pagou × típico,
 * docs/06) está DELIBERADAMENTE fora de escopo até o gatilho — cobertura
 * MEDIDA, não uma data — ser atingido: mediana (nunca a média — decisão
 * travada nº6) da fração por cupom passando de ~60% num cupom típico. Sem
 * medição, não dá nem para saber se o gatilho já chegou. Este job só mede;
 * não constrói UI nem decide nada sozinho — o resultado é lido por humano.
 *
 * Rodado por scheduler externo (GitHub Actions cron em
 * `.github/workflows/cobertura-tipico.yml`) e também à mão (workspace
 * @barganha/backend):
 *   npm run job:cobertura-tipico
 *
 * Por que o cron existe: o gatilho é uma medição, não uma data — e medição que
 * ninguém roda não dispara nada. Sem ele, descobrir que a cobertura passou de
 * 60% dependeria de alguém LEMBRAR de rodar o job meses depois. O cron mede
 * mensalmente e avisa no webhook quando o gatilho vira. Continua não decidindo
 * nada: construir a UI de "economia real" é decisão humana.
 */

import { fileURLToPath } from 'node:url';

import { mediana } from '@barganha/shared';

import { lerConfig } from '../config/env';
import { enviarAlerta } from '../observabilidade/alerta-parsing';
import { logDeJob } from '../observabilidade/log';
import { sanitizarErro, sanitizarErroInesperado } from '../observabilidade/sanitizar';
import type { criarClienteSupabase } from '../persistencia/supabase';
import { criarClienteSupabase as criarClienteSupabaseReal } from '../persistencia/supabase';

/** "Cupom típico" cruzando 60% dos itens com típico gravado — o gatilho da UI (docs/06). */
export const LIMIAR_GATILHO = 0.6;

/**
 * Silenciador do aviso: vire para `true` no MESMO commit que entregar a UI de
 * "economia real".
 *
 * Existe porque este gatilho, ao contrário dos parâmetros de calibração, não se
 * desarma sozinho: cobertura que passou de 60% fica passada para sempre, então
 * um aviso condicionado só a `atingiuGatilho` continuaria pipocando todo mês
 * anos depois da UI pronta — e alerta que não morre é alerta que se aprende a
 * ignorar. A decisão de "já atendi isto" é humana e fica versionada aqui, não
 * num estado escondido que ninguém audita.
 */
export const UI_ECONOMIA_REAL_ENTREGUE = false;
/** Página das varreduras — mesmo teto do `max_rows` do PostgREST (ver repositorio-supabase.ts). */
const PAGINA = 1000;
/** Lote de `cupom_id` por consulta de `item_cupom` — evita um `.in()` gigante. */
const LOTE_CUPONS = 200;

// ─────────────────────────── Núcleo puro (testável) ───────────────────────

export interface CoberturaPorCupom {
  cupomId: string;
  totalItens: number;
  itensComTipico: number;
}

export interface ResumoCobertura {
  cuponsAvaliados: number;
  cuponsElegiveis: number; // com ao menos 1 item
  coberturaMedianaPorCupom: number; // 0..1 — a métrica que decide o gatilho
  coberturaAgregada: number; // 0..1 — total de itens com típico / total de itens, informativo
  atingiuGatilho: boolean; // coberturaMedianaPorCupom >= LIMIAR_GATILHO
}

/**
 * Núcleo testável: calcula a cobertura a partir das linhas já agregadas por
 * cupom. Sem I/O próprio. "Cobertura de um cupom típico" = MEDIANA da fração
 * por cupom (nunca a média — a mesma disciplina do resto do projeto: um
 * único cupom gigante e 100% coberto não pode mascarar cem cupons a zero).
 *
 * Cupons com `totalItens === 0` (não deveria acontecer, mas não se filtra
 * silenciosamente sem contar) entram em `cuponsAvaliados` e saem de
 * `cuponsElegiveis`/da mediana/da agregada.
 */
export function calcularCobertura(linhas: readonly CoberturaPorCupom[]): ResumoCobertura {
  const elegiveis = linhas.filter((l) => l.totalItens > 0);

  const fracoesPorCupom = elegiveis.map((l) => l.itensComTipico / l.totalItens);
  const coberturaMedianaPorCupom = elegiveis.length > 0 ? (mediana(fracoesPorCupom) ?? 0) : 0;

  const totalItens = elegiveis.reduce((acc, l) => acc + l.totalItens, 0);
  const totalComTipico = elegiveis.reduce((acc, l) => acc + l.itensComTipico, 0);
  const coberturaAgregada = totalItens > 0 ? totalComTipico / totalItens : 0;

  return {
    cuponsAvaliados: linhas.length,
    cuponsElegiveis: elegiveis.length,
    coberturaMedianaPorCupom,
    coberturaAgregada,
    atingiuGatilho: coberturaMedianaPorCupom >= LIMIAR_GATILHO,
  };
}

// ────────────────────────────── Wiring (Supabase) ─────────────────────────

type Db = ReturnType<typeof criarClienteSupabase>;

/** Varre uma consulta paginada (teto do PostgREST) até a página vir incompleta. */
async function buscarTudo<T>(
  pagina: (
    de: number,
    ate: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
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

function fatiar<T>(itens: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Monta `CoberturaPorCupom[]` a partir do banco: (1) ids de `cupom` com
 * `status = 'processado'`; (2) `item_cupom` desses cupons, em lotes de
 * `LOTE_CUPONS` ids (sem join direto no supabase-js), trazendo só
 * `cupom_id, tipico_mediana`. Agrega em JS por `cupom_id`.
 */
async function carregarCobertura(db: Db): Promise<CoberturaPorCupom[]> {
  const cupons = await buscarTudo<{ id: string }>(
    (de, ate) => db.from('cupom').select('id').eq('status', 'processado').range(de, ate),
    'cupom',
  );
  if (cupons.length === 0) return [];

  const porCupom = new Map<string, { totalItens: number; itensComTipico: number }>();
  for (const c of cupons) porCupom.set(c.id, { totalItens: 0, itensComTipico: 0 });

  const cupomIds = cupons.map((c) => c.id);
  for (const lote of fatiar(cupomIds, LOTE_CUPONS)) {
    const itens = await buscarTudo<{ cupom_id: string; tipico_mediana: number | string | null }>(
      (de, ate) =>
        db
          .from('item_cupom')
          .select('cupom_id, tipico_mediana')
          .in('cupom_id', lote)
          .range(de, ate),
      'item_cupom',
    );
    for (const i of itens) {
      const acc = porCupom.get(i.cupom_id);
      if (!acc) continue; // defensivo: item de um cupom fora do lote não deveria ocorrer
      acc.totalItens++;
      if (i.tipico_mediana != null) acc.itensComTipico++;
    }
  }

  return [...porCupom.entries()].map(([cupomId, acc]) => ({
    cupomId,
    totalItens: acc.totalItens,
    itensComTipico: acc.itensComTipico,
  }));
}

function formatarPercentual(fracao: number): string {
  return `${Math.round(fracao * 100)}%`;
}

// ─────────────────── Aviso: o gatilho da UI virou ─────────────────────────

/**
 * Mensagem do webhook. `undefined` enquanto o gatilho não vira — ou depois que
 * a UI já foi entregue (ver `UI_ECONOMIA_REAL_ENTREGUE`).
 *
 * `entregue` é parâmetro em vez de leitura direta da constante para o teste
 * conseguir cobrir os dois lados sem depender do valor vigente no código.
 */
export function formatarAvisoCobertura(
  resumo: ResumoCobertura,
  entregue: boolean = UI_ECONOMIA_REAL_ENTREGUE,
): string | undefined {
  if (!resumo.atingiuGatilho || entregue) return undefined;
  return [
    '🟢 Barganha — o gatilho da UI de "economia real" foi atingido',
    `Cobertura mediana por cupom: ${formatarPercentual(resumo.coberturaMedianaPorCupom)} ` +
      `(gatilho: ${formatarPercentual(LIMIAR_GATILHO)}) sobre ${resumo.cuponsElegiveis} cupons.`,
    'A UI (pagou × típico) estava fora de escopo esperando exatamente isto — docs/06.',
    'Ao entregá-la, virar `UI_ECONOMIA_REAL_ENTREGUE` para `true` no mesmo commit, ' +
      'senão este aviso volta todo mês.',
  ].join('\n');
}

/** Monta as peças reais (Supabase), roda a medição e loga um resumo — inclusive em texto legível. */
export async function rodarJobCoberturaTipico(): Promise<ResumoCobertura> {
  const log = logDeJob('cobertura-tipico');
  const config = lerConfig();
  const db = criarClienteSupabaseReal(config.supabaseUrl, config.supabaseServiceRoleKey);

  const linhas = await carregarCobertura(db);
  const resumo = calcularCobertura(linhas);

  log.info(
    {
      action: 'cobertura_tipico.concluido',
      ...resumo,
    },
    'Medição de cobertura do típico na compra concluída',
  );

  // Rodado manualmente por humano decidindo se chegou a hora da UI de
  // "economia real" — vale um console.log legível além do log estruturado.
  console.log(
    `Cobertura mediana por cupom: ${formatarPercentual(resumo.coberturaMedianaPorCupom)} ` +
      `(gatilho: ${formatarPercentual(LIMIAR_GATILHO)}) — ${resumo.atingiuGatilho ? 'ATINGIDO' : 'AINDA NÃO'}`,
  );
  console.log(
    `Cupons avaliados: ${resumo.cuponsAvaliados} · elegíveis: ${resumo.cuponsElegiveis} · ` +
      `cobertura agregada: ${formatarPercentual(resumo.coberturaAgregada)}`,
  );

  await avisarSeGatilhoVirou(resumo, log);

  return resumo;
}

/**
 * Manda ao webhook o aviso de gatilho atingido. Falhar em AVISAR nunca derruba
 * a medição — mesmo tratamento do `job:alerta-parsing`.
 */
async function avisarSeGatilhoVirou(
  resumo: ResumoCobertura,
  log: ReturnType<typeof logDeJob>,
): Promise<void> {
  const mensagem = formatarAvisoCobertura(resumo);
  if (mensagem === undefined) return;

  // `warn`, não `error`: nada quebrou — há uma decisão de produto devida.
  log.warn(
    { action: 'cobertura_tipico.gatilho_atingido', cobertura: resumo.coberturaMedianaPorCupom },
    'Cobertura do típico cruzou o gatilho da UI de economia real',
  );

  const webhookUrl = process.env.ALERTA_WEBHOOK_URL;
  try {
    const enviado = await enviarAlerta(mensagem, { ...(webhookUrl ? { webhookUrl } : {}) });
    if (!enviado && webhookUrl) {
      log.warn({ action: 'cobertura_tipico.webhook_recusado' }, 'Webhook não aceitou o aviso');
    }
  } catch (erro) {
    log.warn(
      { action: 'cobertura_tipico.webhook_falhou', erro: sanitizarErro(erro) },
      'Falha ao enviar o aviso ao webhook',
    );
  }
}

// Executado direto (não quando importado por um teste): roda e propaga o código
// de saída para o operador detectar falha.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rodarJobCoberturaTipico().catch((erro) => {
    // Catch-all do job — com pilha (C10.4), ver nota em `recalculo-estatistica`.
    logDeJob('cobertura-tipico').fatal(
      { erro: sanitizarErroInesperado(erro) },
      'Job de cobertura do típico falhou',
    );
    process.exitCode = 1;
  });
}
