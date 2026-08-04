import type { NotaEstruturada } from '@barganha/shared';
import { describe, expect, it, vi } from 'vitest';

import type { Telemetria } from '../observabilidade/telemetria';
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

  it('marca em_promocao e publica o preço EFETIVO (líquido do desconto do item)', async () => {
    // LEITE: unitário cheio 5,29 com desconto de 0,50 → o consumidor pagou 4,79.
    // Publicar 5,29 faria o "menor promocional" reportar um preço que ninguém pagou.
    const r = await new Anonimizador(catalogoFake()).anonimizar(NOTA, CONTEXTO);
    expect(r.observacoes[1]).toMatchObject({ emPromocao: true, precoNormalizado: 4.79 });
  });

  it('rateia o desconto do item pela quantidade ao publicar o preço efetivo', async () => {
    const nota: NotaEstruturada = {
      ...NOTA,
      itens: [
        {
          descricao: 'SABAO EM PO 1KG',
          ean: '7891234500017',
          quantidade: 2,
          unidade: 'UN',
          valorUnitario: 10,
          valorTotal: 20,
          desconto: 1, // desconto TOTAL do item → R$ 0,50 por unidade
        },
      ],
    };
    const r = await new Anonimizador(catalogoFake()).anonimizar(nota, CONTEXTO);
    expect(r.observacoes[0]).toMatchObject({ emPromocao: true, precoNormalizado: 9.5 });
    // O lado privado preserva os valores originais da nota (unitário cheio).
    expect(r.itensPrivados[0]).toMatchObject({ valorUnitario: 10, desconto: 1 });
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
    const r = await new Anonimizador(catalogo).anonimizar(notaDeUmItem('CX'), CONTEXTO);
    expect(catalogo.casarPorDescricao).not.toHaveBeenCalled();
    expect(r.observacoes).toHaveLength(0);
    expect(r.itensPrivados).toHaveLength(1); // privado guarda mesmo assim
  });

  it('multipack com contagem na descrição entra no pool como R$/un (C3.4)', async () => {
    const catalogo = catalogoFake();
    const r = await new Anonimizador(catalogo).anonimizar(
      notaDeUmItem('CX', 'CERVEJA LATA 12X350ML'),
      CONTEXTO,
    );
    expect(catalogo.casarPorDescricao).toHaveBeenCalledWith({
      descricaoNormalizada: 'CERVEJA LATA 12X350ML',
      unidadeBase: 'un',
    });
    // R$ 36 a caixa de 12 = R$ 3,00 a lata — comparável com a lata solta.
    expect(r.observacoes).toEqual([
      expect.objectContaining({ precoNormalizado: 3, unidadeBase: 'un' }),
    ]);
  });

  it('C3.4 — conta unidade DESCONHECIDA na telemetria (abreviação que falta no mapa)', async () => {
    const telemetria: Telemetria = {
      registrarParsing: vi.fn(),
      registrarUnidadeRecusada: vi.fn(),
    };
    await new Anonimizador(catalogoFake(), telemetria).anonimizar(
      notaDeUmItem('XPTO'),
      CONTEXTO,
      'RJ',
    );
    expect(telemetria.registrarUnidadeRecusada).toHaveBeenCalledWith('RJ', 'XPTO');
  });

  it('C3.4 — NÃO conta embalagem múltipla conhecida (CX) sem contagem: gap já esperado', async () => {
    const telemetria: Telemetria = {
      registrarParsing: vi.fn(),
      registrarUnidadeRecusada: vi.fn(),
    };
    await new Anonimizador(catalogoFake(), telemetria).anonimizar(notaDeUmItem('CX'), CONTEXTO, 'RJ');
    expect(telemetria.registrarUnidadeRecusada).not.toHaveBeenCalled();
  });
});

/** Nota de um único item, para exercitar a normalização da unidade. */
function notaDeUmItem(unidade: string, descricao = 'CERVEJA LATA'): NotaEstruturada {
  return {
    ...NOTA,
    itens: [{ descricao, quantidade: 1, unidade, valorUnitario: 36, valorTotal: 36 }],
  };
}
