import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseHtmlMg } from './mg';

const html = readFileSync(
  fileURLToPath(new URL('./__fixtures__/mg-nota-1.html', import.meta.url)),
  'utf8',
);

describe('parseHtmlMg (C11.1)', () => {
  const nota = parseHtmlMg(html);

  it('extrai a loja a partir do cabeçalho de MG', () => {
    expect(nota.loja).toEqual({
      cnpj: '17155730000164',
      razaoSocial: 'SUPERMERCADO MINEIRAO LTDA',
      endereco: 'Av. Afonso Pena, 1500 - Centro - Belo Horizonte/MG',
      municipio: 'Belo Horizonte',
      uf: 'MG',
    });
  });

  it('converte a emissão para ISO 8601 (UTC, de -03:00)', () => {
    expect(nota.emitidoEm).toBe('2026-06-22T17:05:00.000Z');
  });

  it('parseia os três itens', () => {
    expect(nota.itens).toHaveLength(3);
  });

  it('item com EAN, quantidade e valores', () => {
    expect(nota.itens[0]).toEqual({
      descricao: 'ACUCAR REFINADO 1KG',
      ean: '7891910000197',
      quantidade: 1,
      unidade: 'UN',
      valorUnitario: 4.29,
      valorTotal: 4.29,
    });
  });

  it('item em promoção carrega o desconto da NFC-e', () => {
    expect(nota.itens[1]).toMatchObject({
      descricao: 'PAO DE FORMA 500G',
      ean: '7891234567895',
      desconto: 1,
    });
  });

  it('item de peso variável sem EAN deriva o valor unitário do total', () => {
    const manga = nota.itens[2]!;
    expect(manga.ean).toBeUndefined();
    expect(manga.unidade).toBe('KG');
    expect(manga.quantidade).toBe(0.64);
    expect(manga.valorUnitario).toBeCloseTo(4.98, 2);
    expect(manga.valorTotal).toBe(3.19);
  });

  it('NUNCA extrai o CPF do consumidor', () => {
    expect(JSON.stringify(nota)).not.toContain('333');
  });
});
