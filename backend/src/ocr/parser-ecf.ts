/**
 * C11.4 — Stubs do OCR de cupons ECF antigos (plano B, não implementado).
 *
 * O contrato (`tipos.ts`) existe para o dia em que um motor de OCR e um parser
 * de ECF entrarem; até lá, estes "null objects" FALHAM EXPLICITAMENTE
 * (`OcrNaoDisponivelError` → HTTP 501) em vez de devolver dado vazio que poderia
 * silenciosamente envenenar a base. O caminho oficial de captura continua sendo
 * o QR-first (decisão travada nº1).
 */

import type { NotaEstruturada } from '@barganha/shared';

import { OcrNaoDisponivelError } from '../erros';
import type { MotorOcr, ParserEcf } from './tipos';

/** Nenhum motor de OCR plugado ainda — rejeita explicitamente. */
export class MotorOcrIndisponivel implements MotorOcr {
  // A entrada é ignorada de propósito: não há motor para processá-la ainda.
  reconhecer(): Promise<string> {
    return Promise.reject(
      new OcrNaoDisponivelError('OCR de cupom ECF ainda não disponível (C11.4 — plano B).'),
    );
  }
}

/**
 * Parser ECF não implementado. O layout dos cupons ECF varia por fabricante de
 * impressora e época — exige fixtures reais e calibração, fora do escopo atual.
 */
export class ParserEcfStub implements ParserEcf {
  parse(): NotaEstruturada {
    throw new OcrNaoDisponivelError(
      'Parser de cupom ECF ainda não implementado (C11.4 — plano B).',
    );
  }
}
