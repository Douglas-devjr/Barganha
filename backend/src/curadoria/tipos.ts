/**
 * C11.5 — Porta de persistência do enriquecimento de produto (curadoria).
 *
 * Escreve SÓ os campos de EXIBIÇÃO do `produto_canonico` (nome amigável, marca,
 * categoria, foto). NUNCA toca `descricao_normalizada` nem o EAN — esses são a
 * base do casamento e não devem mudar por mão humana (mudá-los reescreveria o
 * histórico de preços). Opera só no lado COMPARTILHADO.
 */

export interface EnriquecimentoProduto {
  /** Alvo por id OU por EAN (um dos dois é obrigatório). */
  produtoCanonicoId?: string;
  ean?: string;
  nomeExibicao?: string;
  marca?: string;
  categoria?: string;
  imagemUrl?: string;
}

/** Alvo do enriquecimento automático: produto com EAN e sem nome de exibição. */
export interface AlvoEnriquecimento {
  produtoCanonicoId: string;
  ean: string;
}

/**
 * Um produto no resultado da BUSCA de curadoria — identificação mínima para o
 * curador escolher o alvo certo antes de abrir o formulário de enriquecimento.
 * Deliberadamente sem preço/estatística (esta busca é só metadado, docs/04) e
 * sem `unidadeBase`/`imagemUrl` (o formulário de edição não precisa deles para
 * preencher `prodId`/`prodEan`/`prodNome`/`prodMarca`/`prodCategoria`).
 *
 * Nome distinto do `ProdutoResumo` de `@barganha/shared` de propósito: os dois
 * adaptadores (`repositorio-memoria.ts`/`repositorio-supabase.ts`) já importam
 * aquele tipo no mesmo arquivo, e um identificador duplicado quebraria a
 * compilação.
 */
export interface ProdutoResumoBusca {
  produtoCanonicoId: string;
  ean?: string;
  nomeExibicao?: string;
  marca?: string;
  categoria?: string;
}

/** Página de resultados da busca de curadoria (C11.5). */
export interface PaginaProdutosBusca {
  itens: ProdutoResumoBusca[];
  /** Total de produtos que casam com o termo (para a UI calcular o total de páginas). */
  total: number;
}

export interface RepositorioCuradoria {
  /**
   * Aplica o enriquecimento ao produto-alvo. Devolve o `produtoCanonicoId`
   * afetado, ou `undefined` se nenhum produto casar (id/EAN inexistente).
   */
  enriquecerProduto(dados: EnriquecimentoProduto): Promise<string | undefined>;
  /**
   * Produtos elegíveis ao enriquecimento AUTOMÁTICO por catálogo (C11.5): têm
   * EAN (chave da busca) e ainda não têm `nome_exibicao`. Mais antigos primeiro.
   */
  listarProdutosParaEnriquecer(limite: number): Promise<AlvoEnriquecimento[]>;
  /**
   * Busca produtos por nome (`nome_exibicao`/`descricao_normalizada`) OU EAN —
   * para o curador achar o alvo certo sem decorar o `produtoCanonicoId` de cor.
   * `pagina` é 1-based; `tamanhoPagina` já vem validado/limitado pelo serviço.
   */
  buscarProdutos(
    termo: string,
    pagina: number,
    tamanhoPagina: number,
  ): Promise<PaginaProdutosBusca>;
}
