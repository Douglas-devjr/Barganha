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
}
