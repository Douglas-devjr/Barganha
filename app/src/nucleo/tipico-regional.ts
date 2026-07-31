/**
 * Típico regional OFFLINE de um conjunto de produtos — a base da estimativa da
 * Lista de compras e do veredito por item na gôndola (handoff 3a).
 *
 * Lê o `cache_estatistica` já baixado pelo delta sync e resolve, por produto, a
 * MEDIANA do nível regional mais específico disponível (município → UF), com a
 * mesma regra do motor de alertas (`escolherEstatisticaRegional`) — para o
 * número que a Lista soma ser exatamente o que o app chama de "típico" em
 * qualquer outra tela.
 *
 * Nunca é média: a mediana é a decisão travada nº6. Promoção não entra aqui —
 * `menorPromocional` fica separado, como manda docs/06.
 */

import { escolherEstatisticaRegional } from './alertas-regras';
import { resolverLocalizacao } from './localizacao';

import { cache } from '@/dados';
import type { UnidadeBase } from '@barganha/shared';

export interface TipicoRegional {
  /** Mediana em R$ por unidade-base. */
  mediana: number;
  unidadeBase: UnidadeBase;
  /** Menor preço visto na região (inclui promoção) — informativo, fora do total. */
  menorVisto?: number;
  nObservacoes: number;
  /**
   * Data da observação mais recente por trás desta mediana (ISO). Ausente = idade
   * desconhecida (linha em cache antes da v10, ou backend antigo) — a UI diz
   * "sem data", nunca assume que é de hoje.
   *
   * É a idade do PREÇO, não do sync: `atualizadoEm` do cache é quando o servidor
   * recalculou, e um recálculo geral zera essa idade sem o preço ter mudado.
   */
  observadoEmMaisRecente?: string;
  /** Quando o SERVIDOR recalculou esta faixa — não é a idade do preço (ver acima). */
  atualizadoEm: string;
}

/**
 * Típico de vários produtos numa passada. Produto sem base confiável na região
 * simplesmente não aparece no mapa — a UI mostra "sem preço na sua região" em
 * vez de inventar zero.
 */
export async function tipicosDaRegiao(
  produtoCanonicoIds: readonly string[],
): Promise<Map<string, TipicoRegional>> {
  const resultado = new Map<string, TipicoRegional>();
  if (produtoCanonicoIds.length === 0) return resultado;

  const local = await resolverLocalizacao();
  if (!local) return resultado; // sem região não há o que comparar.

  for (const id of new Set(produtoCanonicoIds)) {
    const estatisticas = await cache.listarEstatisticasDoProduto(id);
    const regional = escolherEstatisticaRegional(estatisticas, local);
    if (!regional?.mediana) continue;

    const candidatos = [regional.minimo, regional.menorPromocional].filter(
      (v): v is number => v != null,
    );

    resultado.set(id, {
      mediana: regional.mediana,
      unidadeBase: regional.unidadeBase,
      ...(candidatos.length > 0 ? { menorVisto: Math.min(...candidatos) } : {}),
      nObservacoes: regional.nObservacoes,
      ...(regional.observadoEmMaisRecente
        ? { observadoEmMaisRecente: regional.observadoEmMaisRecente }
        : {}),
      atualizadoEm: regional.atualizadoEm,
    });
  }

  return resultado;
}
