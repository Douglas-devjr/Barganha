/**
 * C4.5 — Delta de catálogo.
 *
 * O delta de estatística (C4.2) desce PREÇO por `produto_canonico_id`, e só. O
 * app terminava com um cache que sabe quanto custa o produto e não sabe o nome
 * dele — o que aparece na tela como um UUID, ou como a descrição crua do cupom
 * ("ARR TP1 TIO J 5KG"). Aqui descem os dados de exibição (nome/marca/categoria
 * + `unidadeBase`) dos ids que o cliente já tem, para o catálogo ficar navegável
 * SEM SINAL (docs/05).
 *
 * Sem cursor de propósito: quem sabe o que falta é o cliente (ele conhece o
 * próprio cache), e um cursor global obrigaria a baixar o catálogo inteiro do
 * país para achar as poucas linhas que interessam. O pedido é um lote de ids, o
 * teto por chamada é do servidor, e o cliente repagina.
 */

import type { ProdutoResumo, SyncProdutosRequest, SyncProdutosResponse } from '@barganha/shared';

import type { FonteCatalogoSync } from './tipos';

/**
 * Teto de ids por chamada. Espelha o `maxItems` do esquema HTTP — o esquema
 * REJEITA o excesso na borda; aqui o corte existe para quem chama o serviço
 * direto (testes, jobs) não conseguir varrer o catálogo numa consulta só.
 */
export const LIMITE_SYNC_PRODUTOS = 200;

export class ServicoSyncCatalogo {
  constructor(
    private readonly fonte: FonteCatalogoSync,
    private readonly limite: number = LIMITE_SYNC_PRODUTOS,
  ) {}

  async produtos(req: SyncProdutosRequest): Promise<SyncProdutosResponse> {
    // Deduplica ANTES do corte: um lote com repetição desperdiçaria a cota do
    // teto e devolveria menos produtos distintos do que o cliente pediu.
    const ids = [...new Set(req.produtoCanonicoIds)].slice(0, this.limite);
    if (ids.length === 0) return { produtos: [] };

    const resumos = await this.fonte.resumosProdutos(ids);
    return { produtos: naOrdemPedida(resumos, ids) };
  }
}

/**
 * Devolve na ordem em que o cliente pediu. O `in (...)` do Postgres não promete
 * ordem nenhuma; sem isto, um cliente que truncasse a resposta ficaria com um
 * recorte arbitrário em vez do começo da sua própria fila.
 */
function naOrdemPedida(resumos: readonly ProdutoResumo[], ids: readonly string[]): ProdutoResumo[] {
  const porId = new Map(resumos.map((r) => [r.produtoCanonicoId, r]));
  return ids.flatMap((id) => {
    const r = porId.get(id);
    return r ? [r] : [];
  });
}
