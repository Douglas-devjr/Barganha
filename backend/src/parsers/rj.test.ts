import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseHtmlRj } from './rj';

const html = readFileSync(
  fileURLToPath(new URL('./__fixtures__/rj-nota-1.html', import.meta.url)),
  'utf8',
);
// O portal ATUAL do RJ usa o layout ENCAT (igual SP); reusamos o fixture de SP
// para provar o roteamento pela entrada do RJ.
const htmlEncat = readFileSync(
  fileURLToPath(new URL('./__fixtures__/sp-nota-1.html', import.meta.url)),
  'utf8',
);

describe('parseHtmlRj (C2.2)', () => {
  const nota = parseHtmlRj(html);

  it('extrai a loja a partir do cabeçalho', () => {
    expect(nota.loja).toEqual({
      cnpj: '12345678000199',
      razaoSocial: 'SUPERMERCADO MARACANA LTDA',
      endereco: 'Av. Atlantica, 500 - Copacabana - Rio de Janeiro/RJ',
      municipio: 'Rio de Janeiro',
      uf: 'RJ',
    });
  });

  it('converte a emissão para ISO 8601 (UTC, de -03:00)', () => {
    expect(nota.emitidoEm).toBe('2026-06-20T21:30:00.000Z');
  });

  it('parseia os três itens', () => {
    expect(nota.itens).toHaveLength(3);
  });

  it('item com EAN, quantidade e valores', () => {
    expect(nota.itens[0]).toEqual({
      descricao: 'CAFE TORRADO 500G',
      ean: '7890000000017',
      quantidade: 2,
      unidade: 'UN',
      valorUnitario: 16.9,
      valorTotal: 33.8,
    });
  });

  it('item em promoção carrega o desconto da NFC-e', () => {
    expect(nota.itens[1]).toMatchObject({
      descricao: 'LEITE INTEGRAL 1L',
      ean: '7891000100103',
      desconto: 0.5,
    });
  });

  it('item de peso variável sem EAN deriva o valor unitário do total', () => {
    const banana = nota.itens[2]!;
    expect(banana.ean).toBeUndefined();
    expect(banana.unidade).toBe('KG');
    expect(banana.quantidade).toBe(1.235);
    expect(banana.valorUnitario).toBeCloseTo(6.99, 2);
    expect(banana.valorTotal).toBe(8.63);
  });

  it('NUNCA extrai o CPF do consumidor', () => {
    expect(JSON.stringify(nota)).not.toContain('111');
  });
});

describe('parseHtmlRj — portal atual (layout ENCAT)', () => {
  const nota = parseHtmlRj(htmlEncat);

  it('roteia o layout ENCAT e extrai a loja', () => {
    expect(nota.loja.cnpj).toBe('61585865000151');
    expect(nota.loja.razaoSocial).toBe('MERCADO PAULISTA COMERCIO DE ALIMENTOS LTDA');
  });

  it('parseia os itens (mesmo parser de SP)', () => {
    expect(nota.itens).toHaveLength(3);
    expect(nota.itens[0]).toMatchObject({ descricao: 'ARROZ TIPO 1 5KG', quantidade: 1 });
  });
});
