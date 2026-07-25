/** C7 — Regras puras da região derivada do histórico de compras. */

import { describe, expect, it } from 'vitest';

import type { LocalDoCupom } from '../dados/repositorio-produtos';
import { escolherLocalPredominante } from './localizacao-regras';

/** Atalho: "RJ:Niterói" → local; sem `:`, cupom sem município (pré-v8). */
const loc = (s: string): LocalDoCupom => {
  const [uf, municipio] = s.split(':');
  return { uf: uf!, municipio: municipio ?? null };
};

const locais = (...s: string[]): LocalDoCupom[] => s.map(loc);

describe('escolherLocalPredominante', () => {
  it('sem cupom com UF não há região', () => {
    expect(escolherLocalPredominante([])).toBeNull();
  });

  it('resolve município + UF quando as compras concordam', () => {
    expect(escolherLocalPredominante(locais('RJ:Niterói', 'RJ:Niterói'))).toEqual({
      uf: 'RJ',
      municipio: 'Niterói',
    });
  });

  it('uma compra de viagem não muda a região (o predominante ganha)', () => {
    // A mais recente é a de fora — é justamente o caso que "a última" errava.
    const escolhido = escolherLocalPredominante(
      locais('SP:Campinas', 'RJ:Niterói', 'RJ:Niterói', 'RJ:Rio de Janeiro'),
    );
    expect(escolhido).toEqual({ uf: 'RJ', municipio: 'Niterói' });
  });

  it('empate fica com a compra mais recente', () => {
    expect(escolherLocalPredominante(locais('RJ:Niterói', 'RJ:Rio de Janeiro'))).toEqual({
      uf: 'RJ',
      municipio: 'Niterói',
    });
  });

  it('só considera o município da UF vencedora (par coerente)', () => {
    // SP aparece 1×; o município de SP não pode vazar para o recorte do RJ.
    const escolhido = escolherLocalPredominante(locais('SP:Campinas', 'RJ:Niterói', 'RJ:Niterói'));
    expect(escolhido).toEqual({ uf: 'RJ', municipio: 'Niterói' });
  });

  it('cupons sem município (pré-v8) resolvem só a UF', () => {
    expect(escolherLocalPredominante(locais('RJ', 'RJ'))).toEqual({ uf: 'RJ' });
  });

  it('aproveita o município das notas que o têm, mesmo com cupons antigos juntos', () => {
    expect(escolherLocalPredominante(locais('RJ', 'RJ:Niterói', 'RJ'))).toEqual({
      uf: 'RJ',
      municipio: 'Niterói',
    });
  });

  it('normaliza a UF (caixa/espaços) antes de contar', () => {
    expect(escolherLocalPredominante(locais(' rj:Niterói', 'RJ:Niterói'))).toEqual({
      uf: 'RJ',
      municipio: 'Niterói',
    });
  });
});
