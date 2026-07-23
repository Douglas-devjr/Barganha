/**
 * C2.5 — Reprocessamento retroativo por estado.
 *
 * O app guarda o QR cru de QUALQUER UF desde o dia 1. Quando o parser de um
 * estado entra no ar (ou é corrigido para uma nova versão de layout), os
 * cupons pendentes (`qr_capturado`) e os que falharam (`falha`) daquele estado
 * são re-enfileirados para processamento (docs/03).
 */

import type { StatusCupom } from '@barganha/shared';

import type { FilaProcessamento } from '../fila/tipos';
import type { RegistroParsers } from '../parsers/registro';
import type { RepositorioCupom } from '../persistencia/tipos';

/** Status elegíveis a reprocessamento: nunca os já `processado`. */
const STATUS_REPROCESSAVEIS: StatusCupom[] = ['qr_capturado', 'falha'];

export interface OpcoesReprocessamento {
  /** Limite de cupons por lote (evita enfileirar tudo de uma vez). */
  limite?: number;
}

export class ReprocessadorRetroativo {
  constructor(
    private readonly repo: RepositorioCupom,
    private readonly registro: RegistroParsers,
    private readonly fila: FilaProcessamento,
  ) {}

  /** Re-enfileira cupons pendentes/falhos de uma UF. Retorna quantos. */
  async reprocessarUf(uf: string, opcoes: OpcoesReprocessamento = {}): Promise<number> {
    if (!this.registro.suporta(uf)) return 0;

    const ids = await this.repo.listarParaReprocessar({
      uf,
      status: STATUS_REPROCESSAVEIS,
      ...(opcoes.limite !== undefined ? { limite: opcoes.limite } : {}),
    });
    for (const cupomId of ids) {
      await this.fila.enfileirar({ cupomId, uf });
    }
    return ids.length;
  }

  /** Reprocessa todas as UFs com parser disponível. Retorna o total. */
  async reprocessarSuportadas(opcoes: OpcoesReprocessamento = {}): Promise<number> {
    let total = 0;
    for (const uf of this.registro.ufsSuportadas()) {
      total += await this.reprocessarUf(uf, opcoes);
    }
    return total;
  }

  /**
   * Recuperação de BOOT: re-enfileira o que ficou preso em `qr_capturado`.
   *
   * A fila de processamento vive na memória do processo (docs/01 — durabilidade
   * é decisão de infra, C10). Um restart — deploy, ou a instância do free tier
   * acordando depois de dormir — evapora o que estava pendente, e o cupom fica
   * parado em `qr_capturado` para sempre: o app o exibe como "processando" e
   * ninguém nunca mais o toca. Rodar isto no boot fecha o buraco sem trocar a
   * infra da fila.
   *
   * Só `qr_capturado`, nunca `falha`: cupom marcado como falha tem motivo
   * permanente (QR inválido), e re-enfileirá-lo a cada boot seria um laço. Para
   * esses existe o reprocessamento explícito por UF (parser novo entrou).
   */
  async recuperarPendentes(opcoes: OpcoesReprocessamento = {}): Promise<number> {
    let total = 0;
    for (const uf of this.registro.ufsSuportadas()) {
      const ids = await this.repo.listarParaReprocessar({
        uf,
        status: ['qr_capturado'],
        ...(opcoes.limite !== undefined ? { limite: opcoes.limite } : {}),
      });
      for (const cupomId of ids) {
        await this.fila.enfileirar({ cupomId, uf });
      }
      total += ids.length;
    }
    return total;
  }
}
