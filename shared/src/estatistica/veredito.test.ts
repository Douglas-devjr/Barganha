import { describe, expect, it } from 'vitest';

import { classificarPreco, montarVeredito, poucosDados, type FaixaPreco } from './veredito';

const faixaRegional: FaixaPreco = {
  mediana: 6.5,
  p25: 6.0,
  p75: 7.0,
  menorPromocional: 5.0,
  nObservacoes: 12,
  unidadeBase: 'L',
  atualizadoEm: '2026-06-20T00:00:00.000Z',
};

describe('classificarPreco (C3.6)', () => {
  it('abaixo de p25 → barato', () => {
    expect(classificarPreco(5.5, faixaRegional)).toBe('barato');
  });

  it('entre p25 e p75 → na média', () => {
    expect(classificarPreco(6.5, faixaRegional)).toBe('na_media');
  });

  it('acima de p75 → caro', () => {
    expect(classificarPreco(7.9, faixaRegional)).toBe('caro');
  });

  it('NUNCA compara contra o menor promocional (R$5 é promoção, não o típico)', () => {
    // 6,40 está dentro da faixa regular; não pode virar "caro" por causa do R$5.
    expect(classificarPreco(6.4, faixaRegional)).toBe('na_media');
  });

  it('sem percentis, cai para a banda ± em torno da mediana', () => {
    const semPercentis: FaixaPreco = {
      mediana: 10,
      nObservacoes: 4,
      unidadeBase: 'kg',
      atualizadoEm: '2026-06-20T00:00:00.000Z',
    };
    expect(classificarPreco(9, semPercentis)).toBe('barato'); // < 9,5
    expect(classificarPreco(10, semPercentis)).toBe('na_media');
    expect(classificarPreco(11, semPercentis)).toBe('caro'); // > 10,5
  });

  it('sem base nenhuma → sem_dados', () => {
    const vazio: FaixaPreco = {
      nObservacoes: 0,
      unidadeBase: 'un',
      atualizadoEm: '2026-06-20T00:00:00.000Z',
    };
    expect(classificarPreco(5, vazio)).toBe('sem_dados');
  });
});

describe('poucosDados (confiança)', () => {
  it('sinaliza quando a base é pequena', () => {
    expect(poucosDados({ ...faixaRegional, nObservacoes: 2 })).toBe(true);
    expect(poucosDados(faixaRegional)).toBe(false);
  });
});

describe('montarVeredito (híbrido pessoal + regional)', () => {
  it('combina os dois mundos e separa a promoção numa linha à parte', () => {
    const pessoal: FaixaPreco = {
      mediana: 6.2,
      p25: 6.0,
      p75: 6.4,
      menorPromocional: 5.5,
      nObservacoes: 3,
      unidadeBase: 'L',
      atualizadoEm: '2026-06-10T00:00:00.000Z',
    };

    const v = montarVeredito({ precoPrateleira: 7.9, regional: faixaRegional, pessoal });

    expect(v.veredito).toBe('caro'); // destaque = regional
    expect(v.regional?.veredito).toBe('caro');
    expect(v.pessoal?.veredito).toBe('caro');
    // menor visto = o menor entre os dois mundos (R$5 da região).
    expect(v.promocao).toEqual({ menorVisto: 5.0, unidadeBase: 'L' });
  });

  it('quando não há região, o destaque cai para o pessoal', () => {
    const pessoal: FaixaPreco = {
      mediana: 6.2,
      p25: 6.0,
      p75: 6.4,
      nObservacoes: 5,
      unidadeBase: 'L',
      atualizadoEm: '2026-06-10T00:00:00.000Z',
    };
    const v = montarVeredito({ precoPrateleira: 5.0, pessoal });
    expect(v.veredito).toBe('barato');
    expect(v.regional).toBeUndefined();
    expect(v.promocao).toBeUndefined();
  });

  it('sem nenhum mundo → sem_dados', () => {
    expect(montarVeredito({ precoPrateleira: 5 }).veredito).toBe('sem_dados');
  });
});
