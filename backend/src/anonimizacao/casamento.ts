/**
 * Casamento de produto ao `produto_canonico`.
 *
 * Dois casamentos DIRETOS (acha-ou-cria), ambos por identidade exata:
 *  • por EAN, quando o portal expõe o código de barras;
 *  • por DESCRIÇÃO normalizada + unidade-base, quando não expõe — vários
 *    portais (ex.: RJ/ENCAT) mostram só o código INTERNO da loja, e sem este
 *    caminho nada do cupom entraria no pool.
 *
 * Identidade exata nunca funde produtos diferentes; o risco é fragmentação
 * ("CR LEITE X 200G" ≠ "CREME DE LEITE X 200G"), que a curadoria resolve
 * fundindo via `produto_alias`. Casamento por SIMILARIDADE segue sendo só
 * sugestão com confirmação (C3.5, docs/06) — nunca automático.
 */

import { type UnidadeBase } from '@barganha/shared';

export interface SugestaoProduto {
  /** Descrição já normalizada (sem acento, maiúsculas) — vira o canônico novo. */
  descricaoNormalizada: string;
  unidadeBase: UnidadeBase;
}

export interface CatalogoProdutos {
  /**
   * Acha o `produto_canonico` pelo EAN ou cria um novo a partir da sugestão.
   * Retorna o `produto_canonico_id`.
   */
  casarPorEan(ean: string, sugestao: SugestaoProduto): Promise<string>;
  /**
   * Acha o `produto_canonico` SEM EAN pela descrição normalizada exata (+ mesma
   * unidade-base) ou cria um novo. Retorna o `produto_canonico_id`.
   */
  casarPorDescricao(sugestao: SugestaoProduto): Promise<string>;
}
