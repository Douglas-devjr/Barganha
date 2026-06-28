/**
 * C4.2 — Serviço de delta sync.
 *
 * Traduz o `DeltaSyncRequest` (cursor + escopo do usuário) num filtro de leitura
 * e devolve o que mudou + o novo cursor. O cursor é o MAIOR `atualizado_em`
 * retornado; na próxima chamada o cliente o reenvia e recebe só o delta seguinte.
 *
 * Sem paginação dura na v1: o escopo do usuário (sua região + seus produtos) é
 * pequeno e o dado é minúsculo (docs/05), então a janela cabe numa resposta. O
 * `limite` é só uma trava de segurança; cursor composto p/ paginar fica em C9.3.
 */

import type { DeltaSyncRequest, DeltaSyncResponse } from '@barganha/shared';

import type { FonteDeltaSync } from './tipos';

/** Trava de segurança de linhas por chamada (ver nota de paginação acima). */
export const LIMITE_DELTA_SYNC = 1000;

export class ServicoSync {
  constructor(
    private readonly fonte: FonteDeltaSync,
    private readonly limite: number = LIMITE_DELTA_SYNC,
  ) {}

  async delta(req: DeltaSyncRequest): Promise<DeltaSyncResponse> {
    const estatisticas = await this.fonte.deltaEstatisticas({
      ...(req.cursor ? { desde: req.cursor } : {}),
      ...(req.municipios && req.municipios.length > 0 ? { escopoIds: req.municipios } : {}),
      ...(req.produtoCanonicoIds && req.produtoCanonicoIds.length > 0
        ? { produtoCanonicoIds: req.produtoCanonicoIds }
        : {}),
      limite: this.limite,
    });

    // Novo cursor = maior atualizado_em do lote; nada novo → mantém o anterior.
    const cursor = estatisticas.reduce(
      (max, e) => (e.atualizadoEm > max ? e.atualizadoEm : max),
      req.cursor ?? '',
    );

    return { estatisticas, cursor };
  }
}
