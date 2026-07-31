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

  it('suprime a célula (loja × produto) abaixo do piso de exposição (docs/04)', async () => {
    const servico = new ServicoComparacaoLista(
      fonte([
        // Loja 111: um item maduro (n=5) e outro visto uma vez só (n=1).
        linha({ lojaCnpj: '111', produtoCanonicoId: 'arroz', mediana: 10, nObservacoes: 5 }),
        linha({ lojaCnpj: '111', produtoCanonicoId: 'feijao', mediana: 20, nObservacoes: 1 }),
        // Loja 222 só tem células rasas → não pode aparecer no ranking.
        linha({ lojaCnpj: '222', produtoCanonicoId: 'arroz', mediana: 5, nObservacoes: 2 }),
      ]),
    );
    const r = await servico.comparar({
      itens: [{ produtoCanonicoId: 'arroz' }, { produtoCanonicoId: 'feijao' }],
    });

    expect(r.lojas.map((l) => l.lojaCnpj)).toEqual(['111']);
    expect(r.lojas[0]).toMatchObject({ total: 10, itensCobertos: 1 });
    // O feijão de n=1 vira lacuna, não preço: seria a compra de uma pessoa.
    expect(r.lojas[0]?.itens.find((i) => i.produtoCanonicoId === 'feijao')?.preco).toBeUndefined();
  });

  it('sem estatística de loja no recorte → lista de lojas vazia (não erro)', async () => {
    const servico = new ServicoComparacaoLista(fonte([linha({ ufLoja: 'SP' })]));
    const r = await servico.comparar({ itens: [{ produtoCanonicoId: 'arroz' }], uf: 'RJ' });

    expect(r).toEqual({ itensTotal: 1, lojas: [] });
  });

  describe('evidência do total (o que impede o ranking de virar oráculo)', () => {
    it('soma as observações só dos itens que entraram na conta', async () => {
      const servico = new ServicoComparacaoLista(
        fonte([
          linha({ produtoCanonicoId: 'arroz', mediana: 10, nObservacoes: 40 }),
          linha({ produtoCanonicoId: 'feijao', mediana: 20, nObservacoes: 12 }),
          // Não pedido na cesta: não pode inflar a evidência do total.
          linha({ produtoCanonicoId: 'cafe', mediana: 30, nObservacoes: 999 }),
        ]),
      );
      const r = await servico.comparar({
        itens: [{ produtoCanonicoId: 'arroz' }, { produtoCanonicoId: 'feijao' }],
      });

      expect(r.lojas[0]?.nObservacoes).toBe(52);
    });

    it('a idade da loja é a do item mais VELHO da conta (o elo fraco)', async () => {
      const servico = new ServicoComparacaoLista(
        fonte([
          linha({
            produtoCanonicoId: 'arroz',
            observadoEmMaisRecente: '2026-07-28T00:00:00.000Z',
          }),
          linha({
            produtoCanonicoId: 'feijao',
            mediana: 20,
            observadoEmMaisRecente: '2026-04-02T00:00:00.000Z',
          }),
        ]),
      );
      const r = await servico.comparar({
        itens: [{ produtoCanonicoId: 'arroz' }, { produtoCanonicoId: 'feijao' }],
      });

      // Não adianta o arroz ser de ontem se o feijão da mesma soma é de abril.
      expect(r.lojas[0]?.observadoEmMaisAntigo).toBe('2026-04-02T00:00:00.000Z');
    });

    it('compara datas por INSTANTE, não por texto (`+00:00` do Postgres vs. `Z`)', async () => {
      const servico = new ServicoComparacaoLista(
        fonte([
          // Mesmo instante em dois formatos; o mais antigo de verdade é o `Z`.
          linha({
            produtoCanonicoId: 'arroz',
            observadoEmMaisRecente: '2026-07-28T12:00:00+00:00',
          }),
          linha({
            produtoCanonicoId: 'feijao',
            mediana: 20,
            observadoEmMaisRecente: '2026-07-28T09:00:00.000Z',
          }),
        ]),
      );
      const r = await servico.comparar({
        itens: [{ produtoCanonicoId: 'arroz' }, { produtoCanonicoId: 'feijao' }],
      });

      // Ordenado como string, '2026-07-28T09:00:00.000Z' > '2026-07-28T12:00:00+00:00'
      // seria falso e a resposta viria trocada.
      expect(r.lojas[0]?.observadoEmMaisAntigo).toBe('2026-07-28T09:00:00.000Z');
    });

    it('um item sem data deixa a loja SEM idade — não finge frescor com o resto', async () => {
      const servico = new ServicoComparacaoLista(
        fonte([
          linha({
            produtoCanonicoId: 'arroz',
            observadoEmMaisRecente: '2026-07-28T00:00:00.000Z',
          }),
          // Linha gravada antes da coluna `observado_em_max` existir.
          linha({ produtoCanonicoId: 'feijao', mediana: 20 }),
        ]),
      );
      const r = await servico.comparar({
        itens: [{ produtoCanonicoId: 'arroz' }, { produtoCanonicoId: 'feijao' }],
      });

      expect(r.lojas[0]?.observadoEmMaisAntigo).toBeUndefined();
    });

    it('conta os itens com promoção fora do total (para a loja não parecer cara à toa)', async () => {
      const servico = new ServicoComparacaoLista(
        fonte([
          linha({ produtoCanonicoId: 'arroz', mediana: 10, menorPromocional: 6 }),
          linha({ produtoCanonicoId: 'feijao', mediana: 20 }),
        ]),
      );
      const r = await servico.comparar({
        itens: [{ produtoCanonicoId: 'arroz' }, { produtoCanonicoId: 'feijao' }],
      });

      expect(r.lojas[0]).toMatchObject({ total: 30, itensComPromocao: 1 });
    });

    it('item suprimido pelo piso não empresta evidência ao total', async () => {
      const servico = new ServicoComparacaoLista(
        fonte([
          linha({
            produtoCanonicoId: 'arroz',
            mediana: 10,
            nObservacoes: 5,
            observadoEmMaisRecente: '2026-07-28T00:00:00.000Z',
          }),
          // n=1: fica fora do total, então sua data e seu `n` também ficam.
          linha({
            produtoCanonicoId: 'feijao',
            mediana: 20,
            nObservacoes: 1,
            observadoEmMaisRecente: '2020-01-01T00:00:00.000Z',
          }),
        ]),
      );
      const r = await servico.comparar({
        itens: [{ produtoCanonicoId: 'arroz' }, { produtoCanonicoId: 'feijao' }],
      });

      expect(r.lojas[0]?.nObservacoes).toBe(5);
      // O feijão de 2020 não entrou na soma — não pode envelhecer a loja.
      expect(r.lojas[0]?.observadoEmMaisAntigo).toBe('2026-07-28T00:00:00.000Z');
    });
  });
});
