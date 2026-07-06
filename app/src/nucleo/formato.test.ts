import { describe, expect, it } from 'vitest';

import { dataCurta, moeda, parseMoeda } from './formato';

describe('parseMoeda (valor digitado na prateleira/desconto)', () => {
  it('lê vírgula decimal (teclado pt-BR)', () => {
    expect(parseMoeda('7,90')).toBe(7.9);
    expect(parseMoeda('0,99')).toBe(0.99);
    expect(parseMoeda('12,5')).toBe(12.5);
  });

  it('lê ponto decimal (teclado en-US) — regressão do "7.90 → 790"', () => {
    expect(parseMoeda('7.90')).toBe(7.9);
    expect(parseMoeda('12.50')).toBe(12.5);
  });

  it('lê inteiro sem separador', () => {
    expect(parseMoeda('1234')).toBe(1234);
  });

  it('trata o último separador como decimal e os demais como milhar', () => {
    expect(parseMoeda('1.234,56')).toBe(1234.56);
    expect(parseMoeda('1,234.56')).toBe(1234.56);
  });

  it('ignora símbolos e espaços ("R$ 12,50")', () => {
    expect(parseMoeda('R$ 12,50')).toBe(12.5);
  });

  it('tolera separador solto no fim ("7," enquanto digita)', () => {
    expect(parseMoeda('7,')).toBe(7);
    expect(parseMoeda(',90')).toBe(0.9);
  });

  it('rejeita vazio, zero e não-número', () => {
    expect(parseMoeda('')).toBeNull();
    expect(parseMoeda('0')).toBeNull();
    expect(parseMoeda('0,00')).toBeNull();
    expect(parseMoeda('abc')).toBeNull();
  });
});

describe('moeda / dataCurta', () => {
  it('formata reais com vírgula', () => {
    expect(moeda(7.9)).toBe('R$ 7,90');
  });

  it('dataCurta devolve null para entrada inválida', () => {
    expect(dataCurta(null)).toBeNull();
    expect(dataCurta('não-é-data')).toBeNull();
  });
});
