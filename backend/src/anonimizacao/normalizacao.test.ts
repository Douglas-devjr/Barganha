import { describe, expect, it } from 'vitest';

import { normalizarDescricao, normalizarPreco } from './normalizacao';

describe('normalizarPreco (C2.4)', () => {
  it('mantém R$/kg quando a venda já é por KG', () => {
    expect(normalizarPreco({ unidade: 'KG', valorUnitario: 32.9 })).toEqual({
      unidadeBase: 'kg',
      precoNormalizado: 32.9,
    });
  });

  it('converte preço por grama para R$/kg', () => {
    expect(normalizarPreco({ unidade: 'G', valorUnitario: 0.0329 })).toEqual({
      unidadeBase: 'kg',
      precoNormalizado: 32.9,
    });
  });

  it('converte mililitro para R$/L', () => {
    expect(normalizarPreco({ unidade: 'ml', valorUnitario: 0.005 })).toEqual({
      unidadeBase: 'L',
      precoNormalizado: 5,
    });
  });

  it('trata unidade (UN) como R$/un', () => {
    expect(normalizarPreco({ unidade: 'UN', valorUnitario: 4.79 })).toMatchObject({
      unidadeBase: 'un',
    });
  });

  it('converte dúzia para R$/un', () => {
    expect(normalizarPreco({ unidade: 'DZ', valorUnitario: 12 })).toEqual({
      unidadeBase: 'un',
      precoNormalizado: 1,
    });
  });

  it('devolve undefined para unidade desconhecida (não entra no pool)', () => {
    expect(normalizarPreco({ unidade: 'XPTO', valorUnitario: 10 })).toBeUndefined();
  });

  it('caixa sem contagem fica fora do pool; com contagem, vira R$/un (C3.4)', () => {
    expect(normalizarPreco({ unidade: 'CX', valorUnitario: 48 })).toBeUndefined();
    expect(
      normalizarPreco({ unidade: 'CX', valorUnitario: 48, descricao: 'CERVEJA LATA 12X350ML' }),
    ).toEqual({ unidadeBase: 'un', precoNormalizado: 4 });
  });

  it('devolve undefined para preço inválido', () => {
    expect(normalizarPreco({ unidade: 'KG', valorUnitario: 0 })).toBeUndefined();
  });
});

describe('normalizarDescricao (C2.4)', () => {
  it('remove acentos, sobe a caixa e colapsa espaços', () => {
    expect(normalizarDescricao('  Café  Torrado é bão ')).toBe('CAFE TORRADO E BAO');
  });
});
