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
  /**
   * Ids de produtos com observação. Com `desde`, só os que receberam observação
   * NOVA desde então — recorte por INSERÇÃO, não por emissão: um cupom antigo
   * enviado hoje (offline-first) precisa entrar no recálculo (F1).
   *
   * O sinal de "novo" vive na fila `produto_recalculo_pendente` (alimentada por
   * trigger em toda inserção no pool), NÃO em `observacao_preco.criado_em` — que
   * é granular ao dia justamente para não permitir remontar a cesta (docs/04).
   */
  listarProdutosComObservacoes(desde?: string): Promise<string[]>;
  /**
   * Observações de um produto para agregar. `desdeObservadoEm` (ISO) recorta a
   * JANELA do decaimento no BANCO — sem ele, produtos populares estouram o teto
   * de linhas do PostgREST e a mediana passa a ser calculada sobre uma fatia
   * arbitrária. A leitura é paginada e ordenada por `observado_em` DESC, então
   * um eventual corte descarta sempre a cauda de MENOR peso temporal.
   */
  observacoesDoProduto(
    produtoCanonicoId: string,
    desdeObservadoEm?: string,
  ): Promise<ObservacaoParaAgregacao[]>;
  /**
   * Tira os produtos da fila de pendências após o recálculo. Opcional: o
   * adaptador em memória não tem fila. Best-effort — a fila é uma DICA de
   * trabalho, e reprocessar um produto já recalculado é inofensivo (o upsert é
   * idempotente); perder a dica só adia o recálculo até a próxima varredura.
   */
  limparPendenciaRecalculo?(produtoCanonicoIds: readonly string[]): Promise<void>;
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
  /**
   * `observado_em` da observação mais recente que sustenta o típico (ISO). É a
   * idade do PREÇO — `atualizado_em` é a do recálculo e não serve para isso
   * (ver `EstatisticaCalculada.observadoEmMaisRecente`).
   */
  observadoEmMaisRecente: string;
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
