import { describe, expect, it } from 'vitest';

import { BARGANHA, assertNever } from './index';

describe('@barganha/shared', () => {
  it('expõe o nome e a versão do contrato', () => {
    expect(BARGANHA.nome).toBe('Barganha');
    expect(BARGANHA.versaoContrato).toBe('0.0.0');
  });

  it('assertNever lança ao receber um valor inesperado', () => {
    expect(() => assertNever('inesperado' as never)).toThrow(/não tratado/);
  });
});
