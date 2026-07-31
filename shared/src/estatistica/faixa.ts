/**
 * C7.2 — Montagem de uma `FaixaPreco` a partir de observações soltas.
 *
 * É o lado PESSOAL do veredito híbrido (docs/06): o app já tem o histórico
 * privado no SQLite, então monta aqui — com a MESMA disciplina do backend
 * (mediana/percentis, nunca média; promoção à parte) — o "seu típico".
 *
 * A versão pessoal é deliberadamente simples (percentis não ponderados sobre as
 * compras do próprio usuário). O decaimento temporal ponderado vive no pipeline
 * regional (C3.2); o histórico pessoal é pequeno e recente o bastante para o
 * percentil direto bastar no MVP (a calibrar; docs/06).
 */

import type { UnidadeBase } from '../core';
import type { FaixaPreco } from './veredito';

/** Uma observação de preço já normalizada (R$/unidade_base). */
export interface ObservacaoNormalizada {
  precoNormalizado: number;
  emPromocao: boolean;
  /** Instante observado (ISO 8601) — define a "última atualização" da faixa. */
  observadoEm: string;
}

/**
 * Percentil (interpolação linear) de uma lista JÁ ORDENADA crescente.
 * `q` em [0,1]. Lista vazia → `undefined`.
 */
export function quantil(ordenados: readonly number[], q: number): number | undefined {
  if (ordenados.length === 0) return undefined;
  if (ordenados.length === 1) return ordenados[0];
  const pos = (ordenados.length - 1) * Math.min(Math.max(q, 0), 1);
  const base = Math.floor(pos);
  const resto = pos - base;
  const inferior = ordenados[base];
  if (inferior === undefined) return undefined; // inalcançável (base é válido); satisfaz o tipo
  const superior = ordenados[base + 1] ?? inferior;
  return inferior + (superior - inferior) * resto;
}

/** Mediana de uma lista (não precisa estar ordenada). `undefined` se vazia. */
export function mediana(valores: readonly number[]): number | undefined {
  return quantil(
    [...valores].sort((a, b) => a - b),
    0.5,
  );
}

/**
 * Monta a faixa típica a partir de observações normalizadas:
 *  • mediana/p25/p75/mín/máx vêm só das observações REGULARES (sem promoção),
 *    para o típico não ser puxado por um preço promocional pontual (docs/06);
 *  • `menorPromocional` é o menor preço marcado como promoção (exibido à parte);
 *  • quando TODAS são promoção, usa-as como base do típico (melhor que nada) e
 *    ainda expõe o menor como promoção.
 *
 * `nObservacoes` conta TODAS as observações (regulares + promo) — é a confiança.
 * Retorna `undefined` quando não há nenhuma observação válida.
 */
export function montarFaixaDeObservacoes(
  observacoes: readonly ObservacaoNormalizada[],
  unidadeBase: UnidadeBase,
): FaixaPreco | undefined {
  const validas = observacoes.filter(
    (o) => Number.isFinite(o.precoNormalizado) && o.precoNormalizado > 0,
  );
  if (validas.length === 0) return undefined;

  const regulares = validas.filter((o) => !o.emPromocao);
  const promocionais = validas.filter((o) => o.emPromocao);

  // Base do típico: regulares quando há; senão, tudo (degradado, mas honesto).
  const baseTipico = (regulares.length > 0 ? regulares : validas)
    .map((o) => o.precoNormalizado)
    .sort((a, b) => a - b);

  const menorPromocional =
    promocionais.length > 0 ? Math.min(...promocionais.map((o) => o.precoNormalizado)) : undefined;

  let atualizadoEm = '';
  for (const o of validas) {
    if (o.observadoEm > atualizadoEm) atualizadoEm = o.observadoEm;
  }

  return {
    mediana: quantil(baseTipico, 0.5),
    p25: quantil(baseTipico, 0.25),
    p75: quantil(baseTipico, 0.75),
    ...(menorPromocional != null ? { menorPromocional } : {}),
    nObservacoes: validas.length,
    unidadeBase,
    atualizadoEm,
    // No lado PESSOAL as duas datas coincidem — a faixa é calculada na hora, a
    // partir das próprias compras, então "quando calculei" e "de quando é o dado
    // mais novo" são o mesmo instante. Preencher explicitamente é o que deixa a
    // Verificar exibir a idade sem precisar saber de qual ângulo a faixa veio.
    ...(atualizadoEm ? { observadoEmMaisRecente: atualizadoEm } : {}),
  };
}
