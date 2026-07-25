/**
 * C4.4 — busca no catálogo regional (o cold start de docs/20). O que estes
 * testes travam: o recorte geo, o casamento por termo, o ranking de populares e
 * as regras herdadas (nada de escopo `loja`, teto de servidor no limite).
 */

import { chaveMunicipio, type UnidadeBase } from '@barganha/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { LIMITE_BUSCA_MAX, ServicoBuscaProdutos } from './servico-busca-produtos';

const RIO = chaveMunicipio('RJ', 'Rio de Janeiro');
const GEO = { municipio: 'Rio de Janeiro', uf: 'RJ' };

let repo: RepositorioMemoria;
let servico: ServicoBuscaProdutos;

async function semearProduto(
  descricaoNormalizada: string,
  unidadeBase: UnidadeBase,
  ean: string,
): Promise<string> {
  return repo.casarPorEan(ean, { descricaoNormalizada, unidadeBase });
}

/** Estatística com o mínimo de campos — só o que a busca lê. */
async function semearEstatistica(opcoes: {
  produtoCanonicoId: string;
  escopo: 'loja' | 'municipio' | 'uf';
  escopoId: string;
  mediana: number;
  nObservacoes: number;
  unidadeBase?: UnidadeBase;
}): Promise<void> {
  await repo.upsertEstatisticas([
    {
      produtoCanonicoId: opcoes.produtoCanonicoId,
      escopo: opcoes.escopo,
      escopoId: opcoes.escopoId,
      unidadeBase: opcoes.unidadeBase ?? 'kg',
      mediana: opcoes.mediana,
      p25: opcoes.mediana * 0.9,
      p75: opcoes.mediana * 1.1,
      minimo: opcoes.mediana * 0.8,
      maximo: opcoes.mediana * 1.2,
      nObservacoes: opcoes.nObservacoes,
    },
  ]);
}

beforeEach(() => {
  repo = new RepositorioMemoria();
  servico = new ServicoBuscaProdutos(repo, repo);
});

describe('ServicoBuscaProdutos (C4.4)', () => {
  it('sem termo, devolve os populares da região ordenados por base', async () => {
    const arroz = await semearProduto('ARROZ TIPO 1 5KG', 'kg', '111');
    const feijao = await semearProduto('FEIJAO PRETO 1KG', 'kg', '222');
    await semearEstatistica({
      produtoCanonicoId: arroz,
      escopo: 'municipio',
      escopoId: RIO,
      mediana: 8,
      nObservacoes: 40,
    });
    await semearEstatistica({
      produtoCanonicoId: feijao,
      escopo: 'municipio',
      escopoId: RIO,
      mediana: 9,
      nObservacoes: 12,
    });

    const r = await servico.buscar(GEO);

    expect(r.produtos.map((p) => p.produto.produtoCanonicoId)).toEqual([arroz, feijao]);
    expect(r.produtos[0]?.escopoResolvido).toBe('municipio');
    expect(r.produtos[0]?.estatistica.mediana).toBe(8);
  });

  it('com termo, casa por similaridade de texto e descarta o que não bate', async () => {
    const arroz = await semearProduto('ARROZ TIPO 1 5KG', 'kg', '111');
    const sabao = await semearProduto('SABAO EM PO 1KG', 'kg', '222');
    for (const id of [arroz, sabao]) {
      await semearEstatistica({
        produtoCanonicoId: id,
        escopo: 'municipio',
        escopoId: RIO,
        mediana: 10,
        nObservacoes: 20,
      });
    }

    const r = await servico.buscar({ ...GEO, termo: 'arroz tipo 1' });

    expect(r.produtos).toHaveLength(1);
    expect(r.produtos[0]?.produto.produtoCanonicoId).toBe(arroz);
  });

  /**
   * A regra de busca é diferente da de casamento (ver `casaTermo`): ninguém
   * digita a descrição inteira do cupom na caixa de busca. "arroz" tem
   * similaridade 0,38 com "ARROZ TIPO 1 5KG" — reprovaria no limiar do C3.5.
   */
  it('acha por prefixo: termo curto casa com descrição longa', async () => {
    const arroz = await semearProduto('ARROZ TIPO 1 5KG', 'kg', '111');
    const integral = await semearProduto('ARROZ INTEGRAL 1KG', 'kg', '222');
    for (const id of [arroz, integral]) {
      await semearEstatistica({
        produtoCanonicoId: id,
        escopo: 'municipio',
        escopoId: RIO,
        mediana: 10,
        nObservacoes: 20,
      });
    }

    expect((await servico.buscar({ ...GEO, termo: 'arroz' })).produtos).toHaveLength(2);
    // Todo token digitado precisa prefixar algum da descrição — "int" filtra.
    const soIntegral = await servico.buscar({ ...GEO, termo: 'arroz int' });
    expect(soIntegral.produtos.map((p) => p.produto.produtoCanonicoId)).toEqual([integral]);
  });

  it('tolera erro de digitação pela similaridade', async () => {
    const arroz = await semearProduto('ARROZ INTEGRAL', 'kg', '111');
    await semearEstatistica({
      produtoCanonicoId: arroz,
      escopo: 'municipio',
      escopoId: RIO,
      mediana: 10,
      nObservacoes: 20,
    });

    expect((await servico.buscar({ ...GEO, termo: 'arros integral' })).produtos).toHaveLength(1);
  });

  it('termo sem nenhum casamento devolve vazio (não cai nos populares)', async () => {
    const arroz = await semearProduto('ARROZ TIPO 1 5KG', 'kg', '111');
    await semearEstatistica({
      produtoCanonicoId: arroz,
      escopo: 'municipio',
      escopoId: RIO,
      mediana: 8,
      nObservacoes: 30,
    });

    const r = await servico.buscar({ ...GEO, termo: 'guarda-chuva' });

    expect(r.produtos).toEqual([]);
  });

  it('cai para a UF quando o município não tem o produto', async () => {
    const cafe = await semearProduto('CAFE TORRADO 500G', 'kg', '111');
    await semearEstatistica({
      produtoCanonicoId: cafe,
      escopo: 'uf',
      escopoId: 'RJ',
      mediana: 22,
      nObservacoes: 15,
    });

    const r = await servico.buscar(GEO);

    expect(r.produtos).toHaveLength(1);
    expect(r.produtos[0]?.escopoResolvido).toBe('uf');
  });

  it('não serve estatística de outra região', async () => {
    const arroz = await semearProduto('ARROZ TIPO 1 5KG', 'kg', '111');
    await semearEstatistica({
      produtoCanonicoId: arroz,
      escopo: 'municipio',
      escopoId: chaveMunicipio('SP', 'São Paulo'),
      mediana: 8,
      nObservacoes: 50,
    });

    expect((await servico.buscar(GEO)).produtos).toEqual([]);
  });

  it('nunca serve o escopo loja (supressão de célula pequena, docs/04)', async () => {
    const arroz = await semearProduto('ARROZ TIPO 1 5KG', 'kg', '111');
    await semearEstatistica({
      produtoCanonicoId: arroz,
      escopo: 'loja',
      escopoId: '11111111000101',
      mediana: 8,
      nObservacoes: 2,
    });

    expect((await servico.buscar(GEO)).produtos).toEqual([]);
  });

  it('sem recorte geo não devolve nada (não existe "típico do Brasil")', async () => {
    const arroz = await semearProduto('ARROZ TIPO 1 5KG', 'kg', '111');
    await semearEstatistica({
      produtoCanonicoId: arroz,
      escopo: 'municipio',
      escopoId: RIO,
      mediana: 8,
      nObservacoes: 30,
    });

    expect((await servico.buscar({})).produtos).toEqual([]);
  });

  it('corta o limite pedido no teto do servidor', async () => {
    for (let i = 0; i < LIMITE_BUSCA_MAX + 5; i++) {
      const id = await semearProduto(`PRODUTO ${i} TESTE`, 'un', `ean-${i}`);
      await semearEstatistica({
        produtoCanonicoId: id,
        escopo: 'municipio',
        escopoId: RIO,
        mediana: 5,
        nObservacoes: 10 + i,
        unidadeBase: 'un',
      });
    }

    const r = await servico.buscar({ ...GEO, limite: 500 });

    expect(r.produtos).toHaveLength(LIMITE_BUSCA_MAX);
  });

  it('anexa o resumo de exibição do produto (C11.5)', async () => {
    const arroz = await semearProduto('ARROZ TIPO 1 5KG', 'kg', '111');
    await repo.enriquecerProduto({
      produtoCanonicoId: arroz,
      nomeExibicao: 'Arroz Tio João Tipo 1 5kg',
      marca: 'Tio João',
    });
    await semearEstatistica({
      produtoCanonicoId: arroz,
      escopo: 'municipio',
      escopoId: RIO,
      mediana: 8,
      nObservacoes: 30,
    });

    const r = await servico.buscar({ ...GEO, termo: 'arroz' });

    expect(r.produtos[0]?.produto.nomeExibicao).toBe('Arroz Tio João Tipo 1 5kg');
    expect(r.produtos[0]?.produto.unidadeBase).toBe('kg');
  });
});
