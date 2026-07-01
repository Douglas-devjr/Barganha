/**
 * C3.1/C10 — Job em lote de recálculo de `preco_estatistica`.
 *
 * REDE DE SEGURANÇA do recálculo *best-effort* da ingestão: quando o cupom é
 * processado, o `ProcessadorCupom` já dispara o recálculo dos produtos que
 * entraram no pool (composicao.ts → `aoPublicarPool`). Mas esse disparo é
 * best-effort — se ele falhar (banco instável, etc.), a observação fica no pool
 * sem a estatística correspondente. Este job varre periodicamente os produtos
 * com observação RECENTE (por `criado_em`) e reconstrói a mediana/faixa. O
 * upsert é idempotente, então janelas sobrepostas são seguras.
 *
 * Rodado por um scheduler externo (GitHub Actions cron em
 * `.github/workflows/recalculo-estatistica.yml`, ou o cron da plataforma):
 *   npm run job:recalculo   (workspace @barganha/backend)
 *
 * A janela vem de `RECALCULO_LOOKBACK_MINUTES` (config): `0` = recálculo
 * COMPLETO (todos os produtos com observação).
 */

import { fileURLToPath } from 'node:url';

import { montarBackend } from '../composicao';
import { type ConfigBackend, lerConfig } from '../config/env';

/** Porta mínima do pipeline usada pelo job — recalcula tudo (ou só o recente). */
export interface PipelineRecalculavel {
  /** Recalcula os produtos com observação; `desde` filtra por inserção (F1). */
  recalcularTodos(desde?: string): Promise<number>;
}

export interface OpcoesRecalculoLote {
  /** Janela de retrovisão em minutos; `<= 0` → recálculo COMPLETO. */
  lookbackMinutos: number;
  /** "Agora" injetável para testes determinísticos. */
  agora?: Date;
}

export interface ResumoRecalculoLote {
  /** Início da janela (ISO); ausente em recálculo completo. */
  desde?: string;
  /** Nº de linhas de estatística reescritas (produto × unidade × escopo). */
  linhasRecalculadas: number;
}

/**
 * Núcleo testável: converte a janela em `desde` e chama o pipeline. Sem I/O
 * próprio além do pipeline injetado.
 */
export async function executarRecalculoEmLote(
  pipeline: PipelineRecalculavel,
  opcoes: OpcoesRecalculoLote,
): Promise<ResumoRecalculoLote> {
  const completo = opcoes.lookbackMinutos <= 0;
  const agora = opcoes.agora ?? new Date();
  const desde = completo
    ? undefined
    : new Date(agora.getTime() - opcoes.lookbackMinutos * 60_000).toISOString();
  const linhasRecalculadas = await pipeline.recalcularTodos(desde);
  return { ...(desde ? { desde } : {}), linhasRecalculadas };
}

/** Monta o backend real, roda o recálculo em lote e loga um resumo. */
export async function rodarJobRecalculo(
  config: ConfigBackend = lerConfig(),
): Promise<ResumoRecalculoLote> {
  const { pipelineEstatistica } = montarBackend(config);
  const inicio = Date.now();
  const resumo = await executarRecalculoEmLote(pipelineEstatistica, {
    lookbackMinutos: config.recalculoLookbackMinutos,
  });
  const janela = resumo.desde ? `desde=${resumo.desde}` : 'completo';
  console.log(
    `[recalculo-estatistica] ${janela} linhas=${resumo.linhasRecalculadas} ` +
      `duracao_ms=${Date.now() - inicio}`,
  );
  return resumo;
}

// Executado direto (não quando importado por um teste): roda e propaga o código
// de saída para o scheduler detectar falha.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rodarJobRecalculo().catch((erro) => {
    console.error('[recalculo-estatistica] falhou:', erro);
    process.exitCode = 1;
  });
}
