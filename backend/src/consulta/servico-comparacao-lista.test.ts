/**
 * C12.1 — Regras da comparação de lista: cobertura manda no ranking, mediana é
 * a base (promoção informativa, fora do total), filtro geográfico pela chave
 * normalizada de município e quantidade como multiplicador.
 */

import { describe, expect, it } from 'vitest';

import { ServicoComparacaoLista } from './servico-comparacao-lista';
import type { EstatisticaLojaLinha, FonteComparacaoLojas } from './tipos';

function fonte(linhas: EstatisticaLojaLinha[]): FonteComparacaoLojas {
  return { estatisticasDeLojasPorProdutos: () => Promise.resolve(linhas) };
}

const linha = (p: Partial<EstatisticaLojaLinha>): EstatisticaLojaLinha => ({
  produtoCanonicoId: 'arroz',
  lojaCnpj: '111',
  municipioLoja: 'Rio de Janeiro',
  ufLoja: 'RJ',
  mediana: 10,
  nObservacoes: 5,
  ...p,
});

describe('ServicoComparacaoLista (C12.1)', () => {
  it('cobertura vem antes do preço: loja com mais itens ganha mesmo mais cara', async () => {
    const servico = new ServicoComparacaoLista(
      fonte([
        // Loja 111 cobre 2 itens (total 30); loja 222 cobre só 1, mais barato (5).
        linha({ lojaCnpj: '111', produtoCanonicoId: 'arroz', mediana: 10 }),
        linha({ lojaCnpj: '111', produtoCanonicoId: 'feijao', mediana: 20 }),
        linha({ lojaCnpj: '222', produtoCanonicoId: 'arroz', mediana: 5 }),
      ]),
    );
    const r = await servico.comparar({
      itens: [{ produtoCanonicoId: 'arroz' }, { produtoCanonicoId: 'feijao' }],
    });

    expect(r.itensTotal).toBe(2);
    expect(r.lojas.map((l) => l.lojaCnpj)).toEqual(['111', '222']);
    expect(r.lojas[0]).toMatchObject({ total: 30, itensCobertos: 2 });
    expect(r.lojas[1]).toMatchObject({ total: 5, itensCobertos: 1 });
    // O item descoberto aparece SEM preço (a UI mostra a lacuna).
    expect(r.lojas[1]?.itens.find((i) => i.produtoCanonicoId === 'feijao')?.preco).toBeUndefined();
  });

  it('empate de cobertura → menor total primeiro; quantidade multiplica a mediana', async () => {
    const servico = new ServicoComparacaoLista(
      fonte([linha({ lojaCnpj: '111', mediana: 10 }), linha({ lojaCnpj: '222', mediana: 8 })]),
    );
    const r = await servico.comparar({ itens: [{ produtoCanonicoId: 'arroz', quantidade: 3 }] });

    expect(r.lojas.map((l) => l.lojaCnpj)).toEqual(['222', '111']);
    expect(r.lojas[0]?.total).toBe(24); // 8 × 3
    expect(r.lojas[1]?.total).toBe(30); // 10 × 3
  });

  it('filtra pela chave normalizada de município (acento/caixa não separam)', async () => {
    const servico = new ServicoComparacaoLista(
      fonte([
        linha({ lojaCnpj: '111', municipioLoja: 'SÃO GONÇALO', ufLoja: 'RJ' }),
        linha({ lojaCnpj: '222', municipioLoja: 'Niterói', ufLoja: 'RJ' }),
      ]),
    );
    const r = await servico.comparar({
      itens: [{ produtoCanonicoId: 'arroz' }],
      municipio: 'sao goncalo',
      uf: 'RJ',
    });

    expect(r.lojas.map((l) => l.lojaCnpj)).toEqual(['111']);
  });

  it('promoção é informativa: aparece no item mas não entra no total', async () => {
    const servico = new ServicoComparacaoLista(
      fonte([linha({ mediana: 10, menorPromocional: 6 })]),
    );
    const r = await servico.comparar({ itens: [{ produtoCanonicoId: 'arroz' }] });

    expect(r.lojas[0]?.total).toBe(10);
    expect(r.lojas[0]?.itens[0]?.menorPromocional).toBe(6);
  });

  it('sem estatística de loja no recorte → lista de lojas vazia (não erro)', async () => {
    const servico = new ServicoComparacaoLista(fonte([linha({ ufLoja: 'SP' })]));
    const r = await servico.comparar({ itens: [{ produtoCanonicoId: 'arroz' }], uf: 'RJ' });

    expect(r).toEqual({ itensTotal: 1, lojas: [] });
  });
});
