import { describe, expect, it } from 'vitest';

import { MIN_OBSERVACOES_EXPOR_LOJA, podeExporEstatistica, podeExporLoja } from './exposicao';

describe('piso de exposição do escopo loja (docs/04)', () => {
  it('suprime a loja abaixo do piso e libera a partir dele', () => {
    expect(podeExporLoja(0)).toBe(false);
    expect(podeExporLoja(MIN_OBSERVACOES_EXPOR_LOJA - 1)).toBe(false);
    expect(podeExporLoja(MIN_OBSERVACOES_EXPOR_LOJA)).toBe(true);
    expect(podeExporLoja(MIN_OBSERVACOES_EXPOR_LOJA + 10)).toBe(true);
  });

  it('só a loja é suprimida — município/região/UF agregam muitas lojas', () => {
    expect(podeExporEstatistica('loja', 1)).toBe(false);
    expect(podeExporEstatistica('municipio', 1)).toBe(true);
    expect(podeExporEstatistica('regiao', 1)).toBe(true);
    expect(podeExporEstatistica('uf', 1)).toBe(true);
  });

  it('o piso é de PRIVACIDADE: nunca abaixo de 2 (n=1 é uma compra só)', () => {
    // Trava de calibração: mexer nesta constante é decisão de LGPD (docs/04),
    // não de qualidade estatística (docs/06). Este teste é o lembrete.
    expect(MIN_OBSERVACOES_EXPOR_LOJA).toBeGreaterThanOrEqual(2);
  });
});
