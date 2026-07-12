/**
 * C4.1 — Porta de resolução de produto na CONSULTA.
 *
 * Diferente do `casarPorEan` da ingestão (que acha-OU-CRIA o canônico), aqui
 * tudo é READ-ONLY: a consulta na gôndola jamais cria produto. Dois caminhos,
 * espelhando a tela Verificar (docs/06): EAN (principal) e nome (fallback).
 *
 * Opera só sobre o lado COMPARTILHADO (produto_canonico + preco_estatistica).
 */

import type { ProdutoResumo } from '@barganha/shared';

import type { CandidatoCanonico } from '../estatistica/casamento-texto';

/**
 * Linha de estatística no escopo LOJA para a comparação de lista (C12.1),
 * já com a referência mínima da loja (nome/geo) para exibição e filtro.
 * Só lado compartilhado: `preco_estatistica` (escopo `loja`) + `loja`.
 */
export interface EstatisticaLojaLinha {
  produtoCanonicoId: string;
  /** `escopo_id` do nível loja = CNPJ. */
  lojaCnpj: string;
  nomeLoja?: string;
  municipioLoja?: string;
  ufLoja?: string;
  mediana?: number;
  menorPromocional?: number;
  nObservacoes: number;
}

/** Fonte das estatísticas por loja para a comparação de lista (C12.1). */
export interface FonteComparacaoLojas {
  /** Todas as linhas escopo `loja` dos produtos pedidos (filtro geo é do serviço). */
  estatisticasDeLojasPorProdutos(
    produtoCanonicoIds: readonly string[],
  ): Promise<EstatisticaLojaLinha[]>;
}

export interface FonteProdutoConsulta {
  /** Lookup direto por EAN; `undefined` se o produto ainda não existe na base. */
  obterProdutoPorEan(ean: string): Promise<string | undefined>;
  /**
   * Candidatos por nome para o ranqueamento por similaridade (C3.5). O serviço
   * escolhe o melhor; o repositório só pré-filtra (reduz o conjunto a pontuar).
   */
  candidatosPorNome(nome: string): Promise<CandidatoCanonico[]>;
  /**
   * Dados de exibição do produto (C11.5) — nome amigável/marca/categoria/foto +
   * `unidadeBase`. Sempre traz a `unidadeBase`; os campos de curadoria vêm só se
   * o produto foi enriquecido. `undefined` se o produto não existe.
   */
  obterResumoProduto(produtoCanonicoId: string): Promise<ProdutoResumo | undefined>;
}
