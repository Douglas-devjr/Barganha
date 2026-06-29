import { describe, expect, it } from 'vitest';

import { OcrNaoDisponivelError } from '../erros';
import { MotorOcrIndisponivel, ParserEcfStub } from './parser-ecf';

describe('OCR de cupom ECF (C11.4) — plano B, ainda não disponível', () => {
  it('o motor de OCR rejeita com OcrNaoDisponivelError', async () => {
    await expect(
      new MotorOcrIndisponivel().reconhecer({ imagemBase64: 'AAAA' }),
    ).rejects.toBeInstanceOf(OcrNaoDisponivelError);
  });

  it('o parser ECF lança OcrNaoDisponivelError (não devolve nota vazia)', () => {
    expect(() => new ParserEcfStub().parse('CUPOM FISCAL ...')).toThrow(OcrNaoDisponivelError);
  });
});
