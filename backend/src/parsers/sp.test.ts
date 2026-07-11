import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseHtmlSp } from './sp';

const html = readFileSync(
  fileURLToPath(new URL('./__fixtures__/sp-nota-1.html', import.meta.url)),
  'utf8',
);

describe('parseHtmlSp (C2.3)', () => {
  const nota = parseHtmlSp(html);

  it('extrai a loja do cabeçalho (layout ENCAT de SP)', () => {
    expect(nota.loja).toEqual({
      cnpj: '61585865000151',
      razaoSocial: 'MERCADO PAULISTA COMERCIO DE ALIMENTOS LTDA',
      endereco: 'Rua das Flores, 123, Centro, SAO PAULO, SP',
      municipio: 'SAO PAULO',
      uf: 'SP',
    });
  });

  it('isola o MUNICÍPIO do endereço em linha única (formato real do portal)', () => {
    // Regressão: capturar "tudo antes da UF" viraria "Rua das Flores, 123,
    // Centro, SAO PAULO" e a chave UF:MUNICIPIO nunca casaria com a cidade
    // escolhida no app (a média regional cairia para a UF).
    expect(nota.loja.municipio).toBe('SAO PAULO');
  });

  it('extrai os totais do cupom (bruto/desconto/pago) da seção #totalNota', () => {
    expect(nota.total).toEqual({ bruto: 46.66, desconto: 2, pago: 44.66 });
  });

  it('converte a emissão para ISO 8601 (UTC, de -03:00)', () => {
    expect(nota.emitidoEm).toBe('2026-06-21T12:15:00.000Z');
  });

  it('parseia os itens com EAN, quantidade e valores', () => {
    expect(nota.itens).toHaveLength(3);
    expect(nota.itens[0]).toEqual({
      descricao: 'ARROZ TIPO 1 5KG',
      ean: '7896006711234',
      quantidade: 1,
      unidade: 'UN',
      valorUnitario: 22.9,
      valorTotal: 22.9,
    });
    expect(nota.itens[1]).toMatchObject({ descricao: 'FEIJAO CARIOCA 1KG', quantidade: 2 });
  });

  it('item de peso (KG) sem EAN cai para casamento por texto depois', () => {
    const tomate = nota.itens[2]!;
    expect(tomate.ean).toBeUndefined();
    expect(tomate.unidade).toBe('KG');
    expect(tomate.quantidade).toBe(0.85);
  });

  it('NUNCA propaga o CPF do consumidor (nem no endereço)', () => {
    expect(JSON.stringify(nota)).not.toContain('222');
    expect(nota.loja.endereco).not.toMatch(/CPF/i);
  });
});
