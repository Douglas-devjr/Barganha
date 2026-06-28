import type { NotaEstruturada } from '@barganha/shared';
import { describe, expect, it, vi } from 'vitest';

import { Anonimizador, type ContextoPrivado } from './anonimizador';
import type { CatalogoProdutos } from './casamento';

const NOTA: NotaEstruturada = {
  loja: {
    cnpj: '12345678000199',
    razaoSocial: 'SUPERMERCADO MARACANA LTDA',
    endereco: 'Av. Atlantica, 500 - Rio de Janeiro/RJ',
    municipio: 'Rio de Janeiro',
    uf: 'RJ',
  },
  emitidoEm: '2026-06-20T21:30:00.000Z',
  itens: [
    {
      descricao: 'CAFE TORRADO 500G',
      ean: '7890000000017',
      quantidade: 2,
      unidade: 'UN',
      valorUnitario: 16.9,
      valorTotal: 33.8,
    },
    {
      descricao: 'LEITE INTEGRAL 1L',
      ean: '7891000100103',
      quantidade: 1,
      unidade: 'UN',
      valorUnitario: 5.29,
      valorTotal: 4.79,
      desconto: 0.5,
    },
    {
      descricao: 'BANANA PRATA',
      quantidade: 1.235,
      unidade: 'KG',
      valorUnitario: 6.99,
      valorTotal: 8.63,
    },
  ],
};

const CONTEXTO: ContextoPrivado = {
  usuarioId: 'user-secreto',
  cupomId: 'cupom-secreto',
  chaveAcesso: '33260612345678000199650010000000011000000016',
};

function catalogoFake(): CatalogoProdutos {
  return { casarPorEan: vi.fn((ean: string) => Promise.resolve(`canon-${ean}`)) };
}

describe('Anonimizador (C2.4)', () => {
  it('mantém todos os itens no lado privado (item_cupom)', async () => {
    const r = await new Anonimizador(catalogoFake()).anonimizar(NOTA, CONTEXTO);
    expect(r.itensPrivados).toHaveLength(3);
    expect(r.itensPrivados[0]).toMatchObject({
      descricaoOriginal: 'CAFE TORRADO 500G',
      produtoCanonicoId: 'canon-7890000000017',
      valorTotal: 33.8,
    });
    // Item sem EAN fica sem canônico (casamento por texto é C3.5).
    expect(r.itensPrivados[2]?.produtoCanonicoId).toBeUndefined();
  });

  it('só envia ao pool itens com EAN casado e preço normalizável', async () => {
    const r = await new Anonimizador(catalogoFake()).anonimizar(NOTA, CONTEXTO);
    expect(r.observacoes).toHaveLength(2);
    expect(r.observacoes[0]).toMatchObject({
      produtoCanonicoId: 'canon-7890000000017',
      lojaCnpj: '12345678000199',
      municipio: 'Rio de Janeiro',
      uf: 'RJ',
      precoNormalizado: 16.9,
      unidadeBase: 'un',
      emPromocao: false,
      observadoEm: '2026-06-20T00:00:00.000Z',
    });
  });

  it('marca em_promocao a partir do desconto da NFC-e', async () => {
    const r = await new Anonimizador(catalogoFake()).anonimizar(NOTA, CONTEXTO);
    expect(r.observacoes[1]).toMatchObject({ emPromocao: true, precoNormalizado: 5.29 });
  });

  it('NUNCA propaga PII para o pool (gate C1.4)', async () => {
    const r = await new Anonimizador(catalogoFake()).anonimizar(NOTA, CONTEXTO);
    const serializado = JSON.stringify(r.observacoes);
    expect(serializado).not.toContain('user-secreto');
    expect(serializado).not.toContain('cupom-secreto');
    expect(serializado).not.toContain('33260612345678000199650010000000011000000016');
    for (const obs of r.observacoes) {
      expect(obs).not.toHaveProperty('usuarioId');
      expect(obs).not.toHaveProperty('cupomId');
      expect(obs).not.toHaveProperty('chaveAcesso');
    }
  });

  it('não casa itens sem EAN (não chama o catálogo à toa)', async () => {
    const catalogo = catalogoFake();
    await new Anonimizador(catalogo).anonimizar(NOTA, CONTEXTO);
    expect(catalogo.casarPorEan).toHaveBeenCalledTimes(2);
  });
});
