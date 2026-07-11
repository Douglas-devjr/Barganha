import { describe, expect, it } from 'vitest';

import {
  chaveMunicipio,
  normalizarDescricao,
  normalizarPreco,
  precoUnitarioEfetivo,
  unidadePadraoDaBase,
} from './normalizacao';

describe('precoUnitarioEfetivo (shared)', () => {
  it('sem desconto: devolve o próprio unitário', () => {
    expect(precoUnitarioEfetivo({ valorUnitario: 5.29, quantidade: 1 })).toBe(5.29);
    expect(precoUnitarioEfetivo({ valorUnitario: 5.29, quantidade: 1, desconto: 0 })).toBe(5.29);
  });

  it('com desconto: rateia o desconto TOTAL do item pela quantidade', () => {
    expect(precoUnitarioEfetivo({ valorUnitario: 5.29, quantidade: 1, desconto: 0.5 })).toBeCloseTo(
      4.79,
      10,
    );
    expect(precoUnitarioEfetivo({ valorUnitario: 10, quantidade: 2, desconto: 1 })).toBe(9.5);
  });

  it('quantidade inválida (0/NaN): não divide, devolve o unitário', () => {
    expect(precoUnitarioEfetivo({ valorUnitario: 10, quantidade: 0, desconto: 1 })).toBe(10);
    expect(precoUnitarioEfetivo({ valorUnitario: 10, quantidade: Number.NaN, desconto: 1 })).toBe(
      10,
    );
  });

  it('desconto maior que o item: resultado ≤ 0 (rejeitado adiante pelo normalizarPreco)', () => {
    const efetivo = precoUnitarioEfetivo({ valorUnitario: 2, quantidade: 1, desconto: 3 });
    expect(efetivo).toBeLessThanOrEqual(0);
    expect(normalizarPreco({ unidade: 'UN', valorUnitario: efetivo })).toBeUndefined();
  });
});

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

  it('trata embalagens unitárias (BJ/EV/FR/PT) como R$/un', () => {
    for (const unidade of ['BJ', 'EV', 'FR', 'PT']) {
      expect(normalizarPreco({ unidade, valorUnitario: 9.98 })).toEqual({
        unidadeBase: 'un',
        precoNormalizado: 9.98,
      });
    }
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

describe('chaveMunicipio', () => {
  it('monta UF:MUNICIPIO normalizado (sem acento, maiúsculas)', () => {
    expect(chaveMunicipio('RJ', 'Rio de Janeiro')).toBe('RJ:RIO DE JANEIRO');
    expect(chaveMunicipio('SP', 'São Paulo')).toBe('SP:SAO PAULO');
  });

  it('casa a forma do parser (caixa alta) com a do seletor (mista)', () => {
    // O parser grava "SAO PAULO"; o usuário escolhe "São Paulo" — mesma chave.
    expect(chaveMunicipio('sp', 'SAO PAULO')).toBe(chaveMunicipio('SP', 'São Paulo'));
  });

  it('devolve vazio quando falta UF ou município', () => {
    expect(chaveMunicipio('', 'Rio de Janeiro')).toBe('');
    expect(chaveMunicipio('RJ', '   ')).toBe('');
  });
});
