/**
 * C7.6 — regras PURAS da busca de produtos (sem I/O, testáveis). O lado que fala
 * com o banco local e com a rede vive em `busca-produtos.ts`.
 *
 * O problema que estas regras resolvem (docs/20): "que produtos eu posso pôr na
 * lista?" tinha uma fonte só — o histórico do próprio usuário — e por isso uma
 * conta nova, sem cupom nenhum, encontrava um app vazio. Agora são duas fontes,
 * e o que está aqui é como elas se convertem numa forma só e se juntam.
 */

import type { ProdutoEncontrado, UnidadeBase } from '@barganha/shared';

import type { ProdutoLocal } from './catalogo';

/** De onde veio o produto — muda o rótulo e o preço de apoio na UI. */
export type OrigemProduto = 'historico' | 'regiao';

/** Um produto que o usuário pode acionar (pôr na lista, pôr na cesta). */
export interface ProdutoBuscavel {
  /** Chave estável de UI; a mesma do catálogo local quando vem de lá. */
  chave: string;
  produtoCanonicoId: string;
  nome: string;
  unidadeBase: UnidadeBase | null;
  origem: OrigemProduto;
  /** "Seu típico" (histórico) ou o típico da região (pool). */
  tipico?: number;
  /** Observações por trás do típico — só faz sentido no lado regional. */
  nObservacoes?: number;
}

function normalizar(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Busca por nome, sem acento e sem caso. Sem texto, devolve tudo. */
export function filtrarPorNome<T extends { nome: string }>(
  itens: readonly T[],
  texto: string,
): T[] {
  const alvo = normalizar(texto);
  if (!alvo) return [...itens];
  return itens.filter((i) => normalizar(i.nome).includes(alvo));
}

/**
 * Converte um produto do histórico. `null` quando não tem id canônico: sem ele
 * não há o que comparar entre lojas, que é a razão de a lista existir.
 */
export function deLocal(p: ProdutoLocal): ProdutoBuscavel | null {
  if (!p.produtoCanonicoId) return null;
  return {
    chave: p.chave,
    produtoCanonicoId: p.produtoCanonicoId,
    nome: p.nome,
    unidadeBase: p.unidadeBase,
    origem: 'historico',
    ...(p.faixaPessoal?.mediana != null ? { tipico: p.faixaPessoal.mediana } : {}),
  };
}

/**
 * Converte um produto do catálogo regional. Sem enriquecimento (C11.5) o backend
 * ainda não tem nome amigável; o nome sai vazio e `comNome` o descarta — mostrar
 * um id (ou a descrição técnica de um cupom) não ajuda ninguém a se decidir.
 */
export function doPool(p: ProdutoEncontrado): ProdutoBuscavel {
  return {
    chave: p.produto.produtoCanonicoId,
    produtoCanonicoId: p.produto.produtoCanonicoId,
    nome: p.produto.nomeExibicao ?? '',
    unidadeBase: p.produto.unidadeBase,
    origem: 'regiao',
    ...(p.estatistica.mediana != null ? { tipico: p.estatistica.mediana } : {}),
    nObservacoes: p.estatistica.nObservacoes,
  };
}

/** Descarta o que não tem nome exibível (ver `doPool`). */
export function comNome(produtos: readonly ProdutoBuscavel[]): ProdutoBuscavel[] {
  return produtos.filter((p) => p.nome.trim().length > 0);
}

/** O recorte do catálogo local que serve para montar lista/cesta. */
export function comparaveis(catalogo: readonly ProdutoLocal[]): ProdutoBuscavel[] {
  return catalogo.flatMap((p) => {
    const b = deLocal(p);
    return b ? [b] : [];
  });
}

/** Filtro local (offline, instantâneo) sobre o catálogo do histórico. */
export function filtrarLocais(catalogo: readonly ProdutoLocal[], termo: string): ProdutoBuscavel[] {
  return filtrarPorNome(comparaveis(catalogo), termo);
}

/**
 * Histórico primeiro; o pool completa sem repetir o que já veio de lá. A ordem
 * importa: o que o usuário já comprou é o que ele reconhece pelo nome, e é o
 * único lado que tem "seu típico".
 */
export function mesclar(
  locais: readonly ProdutoBuscavel[],
  regionais: readonly ProdutoBuscavel[],
): ProdutoBuscavel[] {
  const vistos = new Set(locais.map((p) => p.produtoCanonicoId));
  return [...locais, ...regionais.filter((p) => !vistos.has(p.produtoCanonicoId))];
}
