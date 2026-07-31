/**
 * C4.2 — Porta de leitura do delta sync.
 *
 * Lê só o lado COMPARTILHADO (`preco_estatistica`). O app baixa apenas o que
 * mudou desde o cursor, dentro do seu escopo (região + produtos do histórico) —
 * dado de preço é minúsculo e o sync é incremental, não total (docs/05).
 *
 * A paginação é KEYSET por `(atualizado_em, seq)`: ordenar só por
 * `atualizado_em` fazia o corte no limite de linhas pular o resto de um lote de
 * timestamp idêntico, e pular de vez (o cursor já tinha passado dele). Ver
 * `supabase/migrations/20260722120000_delta_sync_cursor_keyset.sql`.
 */

import type { PrecoEstatistica, ProdutoResumo } from '@barganha/shared';

/** Posição da paginação keyset: a última linha entregue. */
export interface CursorDelta {
  atualizadoEm: string;
  seq: number;
}

export interface FiltroDeltaSync {
  /** Retoma DEPOIS desta posição. Ausente = sync inicial. */
  desde?: CursorDelta;
  /** Recorte geo: chaves de `escopo_id` (`UF:Município` e/ou código de UF). */
  escopoIds?: string[];
  /** Produtos do histórico do usuário a manter no cache. */
  produtoCanonicoIds?: string[];
  /** Teto de linhas por chamada. Estourou = há mais, e o cliente volta. */
  limite: number;
}

/** Linha do delta + a posição de keyset que ela ocupa (não vai ao cliente). */
export interface LinhaDelta {
  estatistica: PrecoEstatistica;
  seq: number;
}

export interface FonteDeltaSync {
  /**
   * Linhas de `preco_estatistica` mudadas depois do cursor, no escopo dado,
   * ORDENADAS por `(atualizado_em, seq)` asc — o serviço deriva o próximo
   * cursor da ÚLTIMA linha retornada (não do máximo: com a ordem garantida, são
   * o mesmo valor, e usar a última deixa explícito que a posição é keyset).
   */
  deltaEstatisticas(filtro: FiltroDeltaSync): Promise<LinhaDelta[]>;
}

/**
 * C4.5 — Porta do delta de CATÁLOGO. Mesma leitura em lote que a busca regional
 * (C4.4) já usa: só `produto_canonico`, nada do mundo privado. Id sem linha no
 * catálogo simplesmente não volta.
 */
export interface FonteCatalogoSync {
  resumosProdutos(produtoCanonicoIds: readonly string[]): Promise<ProdutoResumo[]>;
}
