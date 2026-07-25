/**
 * Congela, por item do cupom, o TÍPICO da região no instante do processamento
 * (`TipicoNaCompra` — ver `shared/dominio/entidades`).
 *
 * Existe para viabilizar a "economia real" (pagou × típico) sem inventar
 * passado: a mediana de hoje não é a de julho, e a série histórica de
 * `preco_estatistica` não é guardada, então o valor é IRRECUPERÁVEL se não for
 * capturado agora. Por isso a captura já roda mesmo antes de existir tela que a
 * consuma — hoje devolve `undefined` para quase tudo (pool raso), e está certo.
 *
 * Duas decisões de baseline:
 *  • O nível LOJA é excluído de propósito. Comparar o que o usuário pagou com a
 *    mediana daquela mesma loja tende a zero (ele é parte dessa mediana) e
 *    responde "peguei promoção aqui?", não "escolhi bem?" — que é a pergunta do
 *    app. A base é município → região → UF, o fallback de docs/06 sem o 1º nível.
 *  • Nada é filtrado por `n` baixo: `resolverFallback` já suprime célula pequena
 *    e o `nObservacoes` viaja junto. Gravar fiel e deixar a UI decidir o piso de
 *    exibição é reversível; descartar na captura, não.
 *
 * Só toca o lado COMPARTILHADO (`preco_estatistica`, agregado e anônimo) para
 * escrever no lado PRIVADO. Nenhum dado do usuário anda no sentido contrário.
 */

import type { EscopoGeo, PrecoEstatistica, TipicoNaCompra } from '@barganha/shared';

import type { ItemCupomNovo } from '../anonimizacao/anonimizador';

import { type LocalGeo, resolverFallback } from './escopos';

/** Porta mínima: exatamente o que `RepositorioEstatistica` já oferece. */
export interface FonteTipico {
  candidatosFallback(produtoCanonicoId: string, local: LocalGeo): Promise<PrecoEstatistica[]>;
}

const NIVEL_EXCLUIDO: EscopoGeo = 'loja';

/** Nível LOJA fora — ver nota do cabeçalho. */
function semNivelLoja(candidatos: readonly PrecoEstatistica[]): PrecoEstatistica[] {
  return candidatos.filter((c) => c.escopo !== NIVEL_EXCLUIDO);
}

/**
 * Devolve os itens com `tipicoNaCompra` preenchido onde houve base. Não muta a
 * entrada. Um produto sem canônico, sem candidatos ou com mediana nula passa
 * intacto — ausência é a resposta honesta, nunca zero.
 *
 * Uma consulta por produto DISTINTO (cupom típico: dezenas). Se isso pesar, o
 * caminho é um `candidatosFallback` em lote no repositório, não cache aqui.
 */
export async function comTipicoNaCompra(
  itens: readonly ItemCupomNovo[],
  local: LocalGeo,
  fonte: FonteTipico,
): Promise<ItemCupomNovo[]> {
  const ids = [
    ...new Set(itens.map((i) => i.produtoCanonicoId).filter((id): id is string => !!id)),
  ];
  if (ids.length === 0) return [...itens];

  const tipicoPorProduto = new Map<string, TipicoNaCompra>();
  for (const id of ids) {
    const candidatos = await fonte.candidatosFallback(id, local);
    const resolvido = resolverFallback(semNivelLoja(candidatos), local);
    if (!resolvido) continue;
    const { estatistica, escopoResolvido } = resolvido;
    if (!estatistica.mediana) continue;
    tipicoPorProduto.set(id, {
      mediana: estatistica.mediana,
      unidadeBase: estatistica.unidadeBase,
      escopo: escopoResolvido,
      nObservacoes: estatistica.nObservacoes,
    });
  }

  return itens.map((item) => {
    const tipico = item.produtoCanonicoId
      ? tipicoPorProduto.get(item.produtoCanonicoId)
      : undefined;
    return tipico ? { ...item, tipicoNaCompra: tipico } : item;
  });
}
