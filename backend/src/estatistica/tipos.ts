/**
 * Portas de persistência do motor estatístico (C3). Mantêm o pipeline e a
 * resolução de fallback independentes do banco — implementadas pelo Supabase
 * (produção) e pelo adaptador em memória (testes/dev), como no resto do backend.
 *
 * Tudo aqui opera SÓ sobre o lado COMPARTILHADO (anônimo): lê `observacao_preco`
 * e escreve/lê `preco_estatistica`. Nada toca o lado privado.
 */

import type { EscopoGeo, PrecoEstatistica, UnidadeBase } from '@barganha/shared';

import type { LocalGeo } from './escopos';

/** Observação anônima pronta p/ agregar (projeção de `observacao_preco`). */
export interface ObservacaoParaAgregacao {
  produtoCanonicoId: string;
  unidadeBase: UnidadeBase;
  lojaCnpj: string;
  municipio?: string;
  uf?: string;
  precoNormalizado: number;
  emPromocao: boolean;
  observadoEm: string;
}

/** Leitura do pool anônimo para o pipeline de agregação. */
export interface FonteObservacoes {
  /** Ids de produtos com observação (opcionalmente só os mexidos desde `desde`). */
  listarProdutosComObservacoes(desde?: string): Promise<string[]>;
  /** Todas as observações de um produto (todos os escopos, dentro do que existe). */
  observacoesDoProduto(produtoCanonicoId: string): Promise<ObservacaoParaAgregacao[]>;
}

/** Linha de `preco_estatistica` calculada pelo pipeline (sem `atualizadoEm`). */
export interface LinhaEstatistica {
  produtoCanonicoId: string;
  escopo: EscopoGeo;
  escopoId: string;
  unidadeBase: UnidadeBase;
  mediana: number;
  p25: number;
  p75: number;
  minimo: number;
  maximo: number;
  menorPromocional?: number;
  nObservacoes: number;
}

/** Escrita do cache de estatística + leitura dos candidatos p/ o fallback. */
export interface RepositorioEstatistica {
  /** Upsert pela PK (produto, escopo, escopo_id, unidade_base); seta `atualizado_em`. */
  upsertEstatisticas(linhas: readonly LinhaEstatistica[]): Promise<void>;
  /**
   * Candidatos para a resolução de fallback (C3.3): as linhas do produto cujos
   * escopos batem com o `local` do usuário (loja/município/região/UF).
   */
  candidatosFallback(produtoCanonicoId: string, local: LocalGeo): Promise<PrecoEstatistica[]>;
}
