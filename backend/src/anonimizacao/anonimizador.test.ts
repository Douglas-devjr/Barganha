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
  return {
    casarPorEan: vi.fn((ean: string) => Promise.resolve(`canon-${ean}`)),
    casarPorDescricao: vi.fn((s: { descricaoNormalizada: string }) =>
      Promise.resolve(`canon-desc-${s.descricaoNormalizada}`),
    ),
  };
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
    // Item sem EAN casa pela descrição normalizada exata (portal sem código de barras).
    expect(r.itensPrivados[2]?.produtoCanonicoId).toBe('canon-desc-BANANA PRATA');
  });

  it('envia ao pool itens casados (EAN ou descrição) com preço normalizável', async () => {
    const r = await new Anonimizador(catalogoFake()).anonimizar(NOTA, CONTEXTO);
    expect(r.observacoes).toHaveLength(3);
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
    // O item de balança (sem EAN) entra normalizado em R$/kg.
    expect(r.observacoes[2]).toMatchObject({
      produtoCanonicoId: 'canon-desc-BANANA PRATA',
      precoNormalizado: 6.99,
      unidadeBase: 'kg',
    });
  });

  it('marca em_promocao a partir do desconto da NFC-e', async () => {
    const r = await new Anonimizador(catalogoFake()).anonimizar(NOTA, CONTEXTO);
    expect(r.observacoes[1]).toMatchObject({ emPromocao: true, precoNormalizado: 5.29 });
  });

  it('usa a UF canônica (da chave) na loja e no pool, ignorando o endereço', async () => {
    const notaUfErrada: NotaEstruturada = {
      ...NOTA,
      loja: { ...NOTA.loja, uf: 'XX' }, // endereço com UF furada
    };
    const r = await new Anonimizador(catalogoFake()).anonimizar(notaUfErrada, CONTEXTO, 'RJ');
    expect(r.loja.uf).toBe('RJ');
    expect(r.observacoes.every((o) => o.uf === 'RJ')).toBe(true);
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

  it('escolhe o casamento certo: EAN quando há, descrição quando não', async () => {
    const catalogo = catalogoFake();
    await new Anonimizador(catalogo).anonimizar(NOTA, CONTEXTO);
    expect(catalogo.casarPorEan).toHaveBeenCalledTimes(2);
    expect(catalogo.casarPorDescricao).toHaveBeenCalledTimes(1);
    expect(catalogo.casarPorDescricao).toHaveBeenCalledWith({
      descricaoNormalizada: 'BANANA PRATA',
      unidadeBase: 'kg',
    });
  });

  it('não casa item sem preço normalizável (unidade fora do mapa)', async () => {
    const catalogo = catalogoFake();
    const nota: NotaEstruturada = {
      ...NOTA,
      itens: [
        {
          descricao: 'CERVEJA PACK 12',
          quantidade: 1,
          unidade: 'CX',
          valorUnitario: 36,
          valorTotal: 36,
        },
      ],
    };
    const r = await new Anonimizador(catalogo).anonimizar(nota, CONTEXTO);
    expect(catalogo.casarPorDescricao).not.toHaveBeenCalled();
    expect(r.observacoes).toHaveLength(0);
    expect(r.itensPrivados).toHaveLength(1); // privado guarda mesmo assim
  });
});
