/**
 * Portas do casamento de item → `produto_canonico`.
 *
 * A ORDEM de resolução (quem tenta primeiro) NÃO mora aqui: mora no
 * `ResolvedorProduto` (`resolvedor-produto.ts`), que é a fonte única. Aqui só
 * ficam os contratos que a persistência implementa.
 *
 * Três casamentos DIRETOS (identidade exata, nunca similaridade):
 *  • por EAN, quando o portal expõe o código de barras;
 *  • por (loja + código interno), quando o portal só expõe o SKU da loja —
 *    chave estável dentro daquela loja (ver `MapaCodigoLoja`);
 *  • por DESCRIÇÃO normalizada + unidade-base, o último recurso — vários
 *    portais (ex.: RJ/ENCAT) mostram só o código INTERNO da loja, e sem este
 *    caminho nada do cupom entraria no pool.
 *
 * Identidade exata nunca funde produtos diferentes; o risco é fragmentação
 * ("CR LEITE X 200G" ≠ "CREME DE LEITE X 200G"), que a curadoria resolve
 * confirmando um `produto_alias` (lido no passo 3 da resolução) ou fundindo os
 * canônicos (`ServicoFusaoCanonicos`). Casamento por SIMILARIDADE segue sendo só
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

/**
 * Consulta de `produto_alias` CONFIRMADO na ingestão (C3.5).
 *
 * Existe porque, até aqui, `produto_alias` era **write-only**: a curadoria
 * confirmava um casamento por texto, gravava a linha — e nada, em lugar nenhum,
 * a lia. O curador decidia no vazio. Esta porta é o que faz a decisão dele
 * valer para todo cupom futuro com aquela descrição.
 */
export interface FonteAliasTexto {
  /**
   * Canônico de um alias CONFIRMADO para esta descrição normalizada + unidade.
   * `undefined` = ninguém confirmou nada para este texto (segue para o passo
   * seguinte). Alias NÃO confirmado nunca é devolvido: sugestão não casa
   * sozinha (docs/06).
   */
  buscarAliasConfirmado(
    textoNormalizado: string,
    unidadeBase: UnidadeBase,
  ): Promise<string | undefined>;
}

/** Como um mapeamento (loja, código) nasceu — governa o quanto ele vale. */
export type OrigemMapeamento = 'ean' | 'descricao_exata' | 'humano';

/** Estado do mapeamento. Só `ativo` usa o limiar normal (ver `avaliarMapeamento`). */
export type StatusMapeamento = 'ativo' | 'suspeito' | 'dormente';

/**
 * Um mapeamento `(loja, código interno) → produto_canonico`.
 *
 * INVARIANTE (não negociável): este mapeamento é **cache de uma decisão tomada
 * por um caminho igual ou mais forte** (EAN, alias humano ou descrição exata).
 * Ele nunca é fonte primária de identidade e **nunca cria** `produto_canonico`.
 * É o que mantém "similaridade nunca casa sozinha" (docs/06) verdadeiro mesmo
 * com a chave nova no caminho.
 */
export interface MapeamentoCodigoLoja {
  lojaCnpj: string;
  codigo: string;
  produtoCanonicoId: string;
  unidadeBase: UnidadeBase;
  /** Descrição normalizada de quando o mapeamento foi criado/reconfirmado. */
  descricaoReferencia: string;
  /**
   * Âncora de preço (R$/unidade-base) — média móvel exponencial LENTA das
   * observações aceitas. NÃO é o típico do produto (isso é `preco_estatistica`,
   * calculado sobre o pool inteiro): é só um valor barato, já carregado junto
   * com a linha, para detectar "este código virou outro produto".
   */
  precoReferencia?: number;
  status: StatusMapeamento;
  origem: OrigemMapeamento;
  /** Dia (YYYY-MM-DD) do último uso aceito — granularidade de DIA por LGPD. */
  ultimoVisto: string;
}

/** Dados para criar/atualizar um mapeamento. */
export interface MapeamentoNovo {
  lojaCnpj: string;
  codigo: string;
  produtoCanonicoId: string;
  unidadeBase: UnidadeBase;
  descricaoReferencia: string;
  precoReferencia?: number;
  origem: OrigemMapeamento;
  /** EAN visto na MESMA loja para este código — ponte EAN ↔ código interno. */
  eanVisto?: string;
}

/**
 * Persistência da chave `(loja_cnpj, codigo)` → `produto_canonico`.
 *
 * Lado COMPARTILHADO e anônimo: é catálogo de LOJA (CNPJ é estabelecimento,
 * não pessoa), sem `usuario_id`, sem `cupom_id`, sem `chave_acesso`. Datas em
 * granularidade de DIA de propósito — com timestamp, duas linhas do mesmo
 * instante reconstruiriam "estes itens estavam na mesma cesta", que é
 * exatamente a impressão digital que docs/04 (regra 2) existe para impedir.
 */
export interface MapaCodigoLoja {
  /** Mapeamento desta loja para este código, seja qual for o `status`. */
  buscarMapeamento(lojaCnpj: string, codigo: string): Promise<MapeamentoCodigoLoja | undefined>;
  /**
   * Mapeamentos de OUTRAS filiais da mesma rede (mesma raiz de CNPJ, 8 dígitos)
   * para este código. Filiais de uma rede costumam compartilhar o ERP, então o
   * código costuma significar o mesmo — mas isso é hipótese, e por isso o
   * alargamento passa por um limiar MAIS ESTRITO e fica atrás de flag.
   */
  buscarMapeamentoDaRede(
    raizCnpj: string,
    codigo: string,
  ): Promise<MapeamentoCodigoLoja | undefined>;
  /** Cria ou atualiza (upsert pela PK loja+código). */
  registrarMapeamento(dados: MapeamentoNovo): Promise<void>;
  /** Uso aceito: `hits`++, `ultimo_visto` = hoje, status volta a `ativo`. */
  registrarUsoMapeamento(
    lojaCnpj: string,
    codigo: string,
    dados: { descricaoReferencia: string; precoReferencia?: number },
  ): Promise<void>;
  /** Marca a linha para a curadoria olhar. NUNCA reaponta o canônico sozinho. */
  marcarMapeamentoSuspeito(lojaCnpj: string, codigo: string, motivo: string): Promise<void>;
}
