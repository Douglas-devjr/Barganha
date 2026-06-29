/**
 * Processador de cupom (worker da fila). Conduz o ciclo de status do cupom:
 *   qr_capturado → (parser disponível? UF habilitada?) → processado | falha
 *
 * Decisões de retry (a fila só repete quando ESTE método LANÇA):
 *  • UF sem parser → retorna sem lançar e SEM mudar status: o cupom fica
 *    `qr_capturado` aguardando reprocessamento retroativo (C2.5).
 *  • UF com parser mas FORA do rollout (C10.3) → idem: fica `qr_capturado` até a
 *    UF ser habilitada; o reprocessamento retroativo a recupera.
 *  • Erro PERMANENTE (layout/parse, QR inválido) → marca `falha`, não lança.
 *  • Erro TRANSITÓRIO (portal fora do ar, rede, banco) → lança: a fila dá
 *    retry com backoff.
 *
 * Cada desfecho é registrado na telemetria por estado (C10.2).
 */

import { ChaveAcessoInvalidaError, FalhaParserSefazError, PayloadQrInvalidoError } from '../erros';
import type { Anonimizador } from '../anonimizacao/anonimizador';
import type { Telemetria } from '../observabilidade/telemetria';
import { telemetriaNula } from '../observabilidade/telemetria';
import { parseQrNfce } from '../parsers/qr-payload';
import type { RegistroParsers } from '../parsers/registro';
import type { RepositorioCupom } from '../persistencia/tipos';
import type { Rollout } from '../rollout/controle-rollout';
import { ROLLOUT_TUDO } from '../rollout/controle-rollout';

/** Erros que NÃO adianta repetir — corrigir o parser, não tentar de novo. */
function ehErroPermanente(erro: unknown): boolean {
  return (
    erro instanceof FalhaParserSefazError ||
    erro instanceof PayloadQrInvalidoError ||
    erro instanceof ChaveAcessoInvalidaError
  );
}

export interface OpcoesProcessador {
  /** Gate de lançamento faseado (C10.3). Omitido → todas as UFs habilitadas. */
  rollout?: Rollout;
  /** Observabilidade por estado (C10.2). Omitido → no-op. */
  telemetria?: Telemetria;
}

export class ProcessadorCupom {
  private readonly rollout: Rollout;
  private readonly telemetria: Telemetria;

  constructor(
    private readonly repo: RepositorioCupom,
    private readonly registro: RegistroParsers,
    private readonly anonimizador: Anonimizador,
    opcoes: OpcoesProcessador = {},
  ) {
    this.rollout = opcoes.rollout ?? ROLLOUT_TUDO;
    this.telemetria = opcoes.telemetria ?? telemetriaNula;
  }

  async processar(cupomId: string): Promise<void> {
    const cupom = await this.repo.obterParaProcessamento(cupomId);
    if (!cupom || cupom.status === 'processado') return;

    // Mantida fora do try para a telemetria de falha saber a UF (cUF da chave).
    let uf = cupom.uf;
    try {
      const qr = parseQrNfce(cupom.qrPayload);
      uf = qr.uf ?? cupom.uf;

      // Sem parser ainda: guarda para reprocessamento retroativo (C2.5).
      if (!uf || !this.registro.suporta(uf)) {
        this.telemetria.registrarParsing(uf, 'sem_parser');
        return;
      }

      // Tem parser, mas a UF ainda não entrou no rollout (C10.3): represa até
      // ser habilitada — o reprocessamento retroativo (C2.5) a recupera depois.
      if (!this.rollout.habilitada(uf)) {
        this.telemetria.registrarParsing(uf, 'uf_nao_habilitada');
        return;
      }

      const parser = this.registro.resolver(uf);
      const nota = await parser.parse(qr);
      // UF da chave (cUF) é canônica — mais confiável que o endereço parseado.
      const resultado = await this.anonimizador.anonimizar(
        nota,
        {
          usuarioId: cupom.usuarioId,
          cupomId: cupom.id,
          ...(cupom.chaveAcesso ? { chaveAcesso: cupom.chaveAcesso } : {}),
        },
        uf,
      );

      await this.repo.marcarProcessado(cupom.id, {
        loja: resultado.loja,
        emitidoEm: resultado.emitidoEm,
        uf,
        itensPrivados: resultado.itensPrivados,
        observacoes: resultado.observacoes,
      });
      this.telemetria.registrarParsing(uf, 'processado');
    } catch (erro) {
      if (ehErroPermanente(erro)) {
        this.telemetria.registrarParsing(uf, 'falha_permanente');
        await this.repo.marcarFalha(cupom.id, erro instanceof Error ? erro.message : String(erro));
        return;
      }
      throw erro; // transitório → a fila dá retry com backoff
    }
  }
}
