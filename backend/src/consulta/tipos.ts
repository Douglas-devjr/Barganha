/**
 * C4.1 — Porta de resolução de produto na CONSULTA.
 *
 * Diferente do `casarPorEan` da ingestão (que acha-OU-CRIA o canônico), aqui
 * tudo é READ-ONLY: a consulta na gôndola jamais cria produto. Dois caminhos,
 * espelhando a tela Verificar (docs/06): EAN (principal) e nome (fallback).
 *
 * Opera só sobre o lado COMPARTILHADO (produto_canonico + preco_estatistica).
 */

import type { PrecoEstatistica, ProdutoResumo } from '@barganha/shared';

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
  /**
   * `observado_em` da observação mais recente que sustenta a mediana (ISO). É a
   * idade do PREÇO; ausente nas linhas gravadas antes da coluna existir.
   */
  observadoEmMaisRecente?: string;
}

/** Fonte das estatísticas por loja para a comparação de lista (C12.1). */
export interface FonteComparacaoLojas {
  /** Todas as linhas escopo `loja` dos produtos pedidos (filtro geo é do serviço). */
  estatisticasDeLojasPorProdutos(
    produtoCanonicoIds: readonly string[],
  ): Promise<EstatisticaLojaLinha[]>;
}

/**
 * Filtro da busca de catálogo regional (C4.4). O recorte é sempre por ESCOPO
 * geográfico já derivado (município/UF) — o nível `loja` não entra: seria expor
 * célula pequena (docs/04) e a busca não pergunta "nesta loja", pergunta "na
 * minha região".
 */
export interface FiltroBuscaProdutos {
  /** Chaves de escopo elegíveis (`UF:MUNICIPIO`, `UF`). Vazio = nada a buscar. */
  escopoIds: readonly string[];
  /** Restringe aos candidatos do casamento por texto. Ausente = populares. */
  produtoCanonicoIds?: readonly string[];
  /** Teto de LINHAS lidas (um produto rende uma por escopo × unidade-base). */
  limite: number;
}

/**
 * Fonte da busca no catálogo regional (C4.4) — o que destrava o cold start
 * (docs/20). Só lado COMPARTILHADO, como toda a consulta.
 */
export interface FonteBuscaProdutos {
  /**
   * Linhas de `preco_estatistica` nos escopos pedidos, das MAIS observadas para
   * as menos (é o ranking de "populares na região"). O serviço agrupa por produto
   * e resolve o nível pelo fallback — aqui é só leitura filtrada.
   */
  estatisticasNoEscopo(filtro: FiltroBuscaProdutos): Promise<PrecoEstatistica[]>;
  /** Resumos de exibição em LOTE (evita uma consulta por produto do resultado). */
  resumosProdutos(produtoCanonicoIds: readonly string[]): Promise<ProdutoResumo[]>;
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
