/**
 * Casamento de produto ao `produto_canonico`.
 *
 * Em C2 só fazemos o casamento DIRETO por EAN (acha-ou-cria o canônico). Itens
 * sem EAN (hortifruti/padaria/açougue) ficam sem canônico por ora e seguem
 * para o casamento por TEXTO com confirmação, que é C3.5 (docs/06). Por isso
 * é uma porta: C3 troca/expande a implementação sem mexer na anonimização.
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
}
