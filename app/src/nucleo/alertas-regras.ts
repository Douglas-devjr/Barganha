/**
 * C8.4 — Regras PURAS dos alertas de preço (testáveis sem React Native):
 * escolher a estatística regional mais específica do cache e decidir se o
 * alerta dispara. A orquestração (SQLite/localização) fica em `alertas.ts`.
 */

import { chaveMunicipio, MIN_OBSERVACOES_CONFIAVEL } from '@barganha/shared';

import type { CacheEstatistica } from '../dados/tipos';

export interface AlertaDisparado {
  produtoCanonicoId: string;
  nome: string;
  precoAlvo: number;
  /** Típico regional (mediana) no nível resolvido. */
  mediana?: number;
  /** Menor preço visto na região (inclui promoção quando houver). */
  menorVisto?: number;
  /** O que cruzou o alvo primeiro: o típico ou o menor visto. */
  motivo: 'tipico' | 'menor_visto';
}

/**
 * Estatística regional mais específica do produto no cache: município (chave
 * canônica) tem prioridade sobre UF; escopo de loja fica fora — alerta é sobre
 * a REGIÃO. `null` sem dado confiável.
 */
export function escolherEstatisticaRegional(
  estatisticas: CacheEstatistica[],
  local: { uf?: string; municipio?: string } | null,
): CacheEstatistica | null {
  if (!local?.uf) return null;
  const confiaveis = estatisticas.filter(
    (e) =>
      e.nObservacoes >= MIN_OBSERVACOES_CONFIAVEL &&
      (e.escopo === 'municipio' || e.escopo === 'uf'),
  );
  const chaveMun = local.municipio ? chaveMunicipio(local.uf, local.municipio) : '';
  const doMunicipio = chaveMun
    ? confiaveis.find((e) => e.escopo === 'municipio' && e.escopoId === chaveMun)
    : undefined;
  if (doMunicipio) return doMunicipio;
  const ufAlvo = local.uf.trim().toUpperCase();
  return confiaveis.find((e) => e.escopo === 'uf' && e.escopoId === ufAlvo) ?? null;
}

/** Avalia UM alerta contra a estatística regional resolvida. */
export function avaliarAlerta(
  alerta: { produtoCanonicoId: string; nome: string; precoAlvo: number },
  estatistica: CacheEstatistica | null,
): AlertaDisparado | null {
  if (!estatistica) return null;
  const mediana = estatistica.mediana ?? undefined;
  const candidatos = [estatistica.minimo, estatistica.menorPromocional].filter(
    (v): v is number => v != null,
  );
  const menorVisto = candidatos.length > 0 ? Math.min(...candidatos) : undefined;

  const tipicoBateu = mediana != null && mediana <= alerta.precoAlvo;
  const menorBateu = menorVisto != null && menorVisto <= alerta.precoAlvo;
  if (!tipicoBateu && !menorBateu) return null;

  return {
    produtoCanonicoId: alerta.produtoCanonicoId,
    nome: alerta.nome,
    precoAlvo: alerta.precoAlvo,
    ...(mediana != null ? { mediana } : {}),
    ...(menorVisto != null ? { menorVisto } : {}),
    motivo: tipicoBateu ? 'tipico' : 'menor_visto',
  };
}
