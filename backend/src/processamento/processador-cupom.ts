/**
 * Processador de cupom (worker da fila). Conduz o ciclo de status do cupom:
 *   qr_capturado → (parser disponível?) → processado | falha
 *
 * Decisões de retry (a fila só repete quando ESTE método LANÇA):
 *  • UF sem parser → retorna sem lançar e SEM mudar status: o cupom fica
 *    `qr_capturado` aguardando reprocessamento retroativo (C2.5).
 *  • Erro PERMANENTE (layout/parse, QR inválido) → marca `falha`, não lança.
 *  • Erro TRANSITÓRIO (portal fora do ar, rede, banco) → lança: a fila dá
 *    retry com backoff.
 */

import { ChaveAcessoInvalidaError, FalhaParserSefazError, PayloadQrInvalidoError } from '../erros';
import type { Anonimizador } from '../anonimizacao/anonimizador';
import { parseQrNfce } from '../parsers/qr-payload';
import type { RegistroParsers } from '../parsers/registro';
import type { RepositorioCupom } from '../persistencia/tipos';

/** Erros que NÃO adianta repetir — corrigir o parser, não tentar de novo. */
function ehErroPermanente(erro: unknown): boolean {
  return (
    erro instanceof FalhaParserSefazError ||
    erro instanceof PayloadQrInvalidoError ||
    erro instanceof ChaveAcessoInvalidaError
  );
}

export class ProcessadorCupom {
  constructor(
    private readonly repo: RepositorioCupom,
    private readonly registro: RegistroParsers,
    private readonly anonimizador: Anonimizador,
  ) {}

  async processar(cupomId: string): Promise<void> {
    const cupom = await this.repo.obterParaProcessamento(cupomId);
    if (!cupom || cupom.status === 'processado') return;

    try {
      const qr = parseQrNfce(cupom.qrPayload);
      const uf = qr.uf ?? cupom.uf;

      // Sem parser ainda: guarda para reprocessamento retroativo (C2.5).
      if (!uf || !this.registro.suporta(uf)) return;

      const parser = this.registro.resolver(uf);
      const nota = await parser.parse(qr);
      const resultado = await this.anonimizador.anonimizar(nota, {
        usuarioId: cupom.usuarioId,
        cupomId: cupom.id,
        ...(cupom.chaveAcesso ? { chaveAcesso: cupom.chaveAcesso } : {}),
      });

      await this.repo.marcarProcessado(cupom.id, {
        loja: resultado.loja,
        emitidoEm: resultado.emitidoEm,
        uf,
        itensPrivados: resultado.itensPrivados,
        observacoes: resultado.observacoes,
      });
    } catch (erro) {
      if (ehErroPermanente(erro)) {
        await this.repo.marcarFalha(cupom.id, erro instanceof Error ? erro.message : String(erro));
        return;
      }
      throw erro; // transitório → a fila dá retry com backoff
    }
  }
}
