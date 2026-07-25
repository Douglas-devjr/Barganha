/**
 * C7.6 — as regras da busca de produtos. O caso que motivou a etapa (docs/20)
 * está no primeiro teste: conta nova, catálogo local vazio, e ainda assim há o
 * que pôr na lista.
 */

import type { ProdutoEncontrado } from '@barganha/shared';
import { describe, expect, it } from 'vitest';

import {
  comNome,
  comparaveis,
  deLocal,
  doPool,
  filtrarLocais,
  filtrarPorNome,
  mesclar,
} from './busca-produtos-regras';
import type { ProdutoLocal } from './catalogo';

function local(parcial: Partial<ProdutoLocal> & { chave: string; nome: string }): ProdutoLocal {
  return {
    produtoCanonicoId: parcial.chave,
    ean: null,
    unidadeBase: 'kg',
    nObservacoes: 1,
    ...parcial,
  };
}

function doServidor(id: string, nome: string | undefined, mediana: number): ProdutoEncontrado {
  return {
    produto: {
      produtoCanonicoId: id,
      ...(nome ? { nomeExibicao: nome } : {}),
      unidadeBase: 'kg',
    },
    escopoResolvido: 'municipio',
    estatistica: {
      produtoCanonicoId: id,
      escopo: 'municipio',
      escopoId: 'RJ:RIO DE JANEIRO',
      unidadeBase: 'kg',
      mediana,
      nObservacoes: 12,
      atualizadoEm: '2026-07-24T00:00:00.000Z',
    },
  };
}

describe('mesclar (C7.6)', () => {
  it('conta nova (histórico vazio) fica só com o catálogo da região', () => {
    const regionais = [doServidor('arroz', 'Arroz Tipo 1', 8)].map(doPool);

    const r = mesclar([], regionais);

    expect(r).toHaveLength(1);
    expect(r[0]?.origem).toBe('regiao');
    expect(r[0]?.tipico).toBe(8);
  });

  it('põe o histórico na frente e não repete o que o pool devolveu de novo', () => {
    const locais = comparaveis([local({ chave: 'arroz', nome: 'ARROZ TIPO 1' })]);
    const regionais = [doServidor('arroz', 'Arroz Tipo 1', 8), doServidor('cafe', 'Café', 20)].map(
      doPool,
    );

    const r = mesclar(locais, regionais);

    expect(r.map((p) => p.produtoCanonicoId)).toEqual(['arroz', 'cafe']);
    // O "arroz" que sobrou é o do histórico — é ele que tem "seu típico".
    expect(r[0]?.origem).toBe('historico');
  });
});

describe('deLocal / comparaveis', () => {
  it('descarta produto sem id canônico (não há o que comparar entre lojas)', () => {
    const semId = local({ chave: 'desc:BOLO CASEIRO', nome: 'BOLO CASEIRO' });
    semId.produtoCanonicoId = null;

    expect(deLocal(semId)).toBeNull();
    expect(comparaveis([semId])).toEqual([]);
  });

  it('leva o típico pessoal quando existe', () => {
    const p = local({ chave: 'arroz', nome: 'ARROZ' });
    p.faixaPessoal = { mediana: 7.5, nObservacoes: 3, unidadeBase: 'kg', atualizadoEm: '' };

    expect(deLocal(p)?.tipico).toBe(7.5);
  });
});

describe('comNome (C11.5)', () => {
  it('descarta produto do pool ainda sem nome de exibição', () => {
    const produtos = [doServidor('a', 'Arroz', 8), doServidor('b', undefined, 9)].map(doPool);

    expect(comNome(produtos).map((p) => p.produtoCanonicoId)).toEqual(['a']);
  });
});

describe('filtrarPorNome', () => {
  it('ignora acento e caixa', () => {
    const itens = [{ nome: 'Café Torrado' }, { nome: 'Arroz' }];

    expect(filtrarPorNome(itens, 'cafe')).toEqual([{ nome: 'Café Torrado' }]);
    expect(filtrarPorNome(itens, 'CAFÉ')).toEqual([{ nome: 'Café Torrado' }]);
  });

  it('sem texto, devolve tudo', () => {
    const itens = [{ nome: 'a' }, { nome: 'b' }];

    expect(filtrarPorNome(itens, '  ')).toHaveLength(2);
  });

  it('filtrarLocais compõe filtro + recorte de comparáveis', () => {
    const catalogo = [
      local({ chave: 'arroz', nome: 'ARROZ TIPO 1' }),
      local({ chave: 'cafe', nome: 'CAFE TORRADO' }),
    ];

    expect(filtrarLocais(catalogo, 'arr').map((p) => p.nome)).toEqual(['ARROZ TIPO 1']);
  });
});
