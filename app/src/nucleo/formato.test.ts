import { describe, expect, it } from 'vitest';

import {
  cnpjPareceValido,
  dataCurta,
  idadeTexto,
  mascararCnpj,
  moeda,
  parseMoeda,
  somenteDigitos,
  vezesCompradas,
} from './formato';

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

describe('idadeTexto (idade do preço na comparação de mercados)', () => {
  it('fala em dias, não em datas', () => {
    expect(idadeTexto(0)).toBe('de hoje');
    expect(idadeTexto(0.4)).toBe('de hoje');
    expect(idadeTexto(1)).toBe('de ontem');
    expect(idadeTexto(1.9)).toBe('de ontem');
    expect(idadeTexto(12.3)).toBe('há 12 dias');
    expect(idadeTexto(43.6)).toBe('há 44 dias');
  });

  it('sem data NÃO vira "de hoje" — desconhecido não é frescor', () => {
    expect(idadeTexto(undefined)).toBe('sem data');
  });
});

describe('vezesCompradas (evidência do típico nas listas de produto)', () => {
  it('sai como frase com verbo, nunca como "N compras" solto', () => {
    expect(vezesCompradas(3)).toBe('comprou 3 vezes');
    expect(vezesCompradas(12)).toBe('comprou 12 vezes');
  });

  it('concorda no singular', () => {
    expect(vezesCompradas(1)).toBe('comprou 1 vez');
  });

  it('sem compra não vira "comprou 0 vezes"', () => {
    expect(vezesCompradas(0)).toBe('sem compra sua ainda');
    expect(vezesCompradas(-1)).toBe('sem compra sua ainda');
  });
});

describe('mascararCnpj / somenteDigitos / cnpjPareceValido (loja do lançamento manual, C11.3)', () => {
  it('formata os dígitos progressivamente enquanto digita', () => {
    expect(mascararCnpj('11')).toBe('11');
    expect(mascararCnpj('11222')).toBe('11.222');
    expect(mascararCnpj('11222333')).toBe('11.222.333');
    expect(mascararCnpj('11222333000')).toBe('11.222.333/000');
    expect(mascararCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('reformata a partir dos dígitos mesmo colando já pontuado', () => {
    expect(mascararCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81');
  });

  it('trunca em 14 dígitos — não deixa crescer além do CNPJ', () => {
    expect(mascararCnpj('112223330001819999')).toBe('11.222.333/0001-81');
  });

  it('somenteDigitos devolve o que a API espera, sem máscara', () => {
    expect(somenteDigitos('11.222.333/0001-81')).toBe('11222333000181');
  });

  it('cnpjPareceValido checa só a quantidade de dígitos (o backend valida o resto)', () => {
    expect(cnpjPareceValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjPareceValido('11.222.333/0001-8')).toBe(false);
    expect(cnpjPareceValido('')).toBe(false);
  });
});
