import { describe, expect, it } from 'vitest';

import { normalizarDescricao, normalizarPreco, unidadePadraoDaBase } from './normalizacao';

describe('normalizarPreco (shared)', () => {
  it('mantém KG como R$/kg (fator 1)', () => {
    expect(normalizarPreco({ unidade: 'KG', valorUnitario: 32.9 })).toEqual({
      unidadeBase: 'kg',
      precoNormalizado: 32.9,
    });
  });

  it('converte G para R$/kg (×1000)', () => {
    expect(normalizarPreco({ unidade: 'G', valorUnitario: 0.0329 })).toEqual({
      unidadeBase: 'kg',
      precoNormalizado: 32.9,
    });
  });

  it('converte ml para R$/L (×1000)', () => {
    expect(normalizarPreco({ unidade: 'ml', valorUnitario: 0.005 })).toEqual({
      unidadeBase: 'L',
      precoNormalizado: 5,
    });
  });

  it('trata UN como R$/un', () => {
    expect(normalizarPreco({ unidade: 'UN', valorUnitario: 4.79 })).toMatchObject({
      unidadeBase: 'un',
      precoNormalizado: 4.79,
    });
  });

  it('converte DZ para R$/un (÷12)', () => {
    expect(normalizarPreco({ unidade: 'DZ', valorUnitario: 12 })).toEqual({
      unidadeBase: 'un',
      precoNormalizado: 1,
    });
  });

  it('rejeita unidade desconhecida (fora do pool)', () => {
    expect(normalizarPreco({ unidade: 'CX', valorUnitario: 10 })).toBeUndefined();
  });

  it('rejeita preço inválido', () => {
    expect(normalizarPreco({ unidade: 'KG', valorUnitario: 0 })).toBeUndefined();
  });
});

describe('unidadePadraoDaBase', () => {
  it('mapeia cada base para sua unidade de venda canônica', () => {
    expect(unidadePadraoDaBase('kg')).toBe('KG');
    expect(unidadePadraoDaBase('L')).toBe('L');
    expect(unidadePadraoDaBase('un')).toBe('UN');
  });

  it('compõe com normalizarPreco mantendo o valor (fator 1)', () => {
    expect(normalizarPreco({ unidade: unidadePadraoDaBase('un'), valorUnitario: 7.9 })).toEqual({
      unidadeBase: 'un',
      precoNormalizado: 7.9,
    });
  });
});

describe('normalizarDescricao', () => {
  it('remove acentos, sobe a caixa e colapsa espaços', () => {
    expect(normalizarDescricao('  Café   Pilão  Torrado ')).toBe('CAFE PILAO TORRADO');
  });
});
