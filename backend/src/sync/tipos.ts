/**
 * C4.2 — Porta de leitura do delta sync.
 *
 * Lê só o lado COMPARTILHADO (`preco_estatistica`). O app baixa apenas o que
 * mudou desde o cursor, dentro do seu escopo (região + produtos do histórico) —
 * dado de preço é minúsculo e o sync é incremental, não total (docs/05).
 */

import type { PrecoEstatistica } from '@barganha/shared';

export interface FiltroDeltaSync {
  /** Só linhas com `atualizado_em` > `desde` (cursor). Ausente = sync inicial. */
  desde?: string;
  /** Recorte geo: chaves de `escopo_id` (`UF:Município` e/ou código de UF). */
  escopoIds?: string[];
  /** Produtos do histórico do usuário a manter no cache. */
  produtoCanonicoIds?: string[];
  /** Teto de segurança de linhas por chamada. */
  limite: number;
}

export interface FonteDeltaSync {
  /**
   * Linhas de `preco_estatistica` mudadas desde o cursor, no escopo dado,
   * ORDENADAS por `atualizado_em` asc (o serviço deriva o próximo cursor do
   * máximo retornado).
   */
  deltaEstatisticas(filtro: FiltroDeltaSync): Promise<PrecoEstatistica[]>;
}
