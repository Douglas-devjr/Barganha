import { describe, expect, it } from 'vitest';

import { mediana, montarFaixaDeObservacoes, quantil, type ObservacaoNormalizada } from './faixa';
import { classificarPreco } from './veredito';

function obs(preco: number, emPromocao = false, observadoEm = '2026-01-01'): ObservacaoNormalizada {
  return { precoNormalizado: preco, emPromocao, observadoEm };
}

describe('quantil', () => {
  it('interpola linearmente numa lista ordenada', () => {
    expect(quantil([10, 20, 30, 40], 0.5)).toBe(25);
    expect(quantil([10, 20, 30, 40], 0.25)).toBe(17.5);
    expect(quantil([10, 20, 30, 40], 0.75)).toBe(32.5);
  });

  it('devolve o único valor com lista de 1', () => {
    expect(quantil([42], 0.5)).toBe(42);
  });

  it('é undefined para lista vazia', () => {
    expect(quantil([], 0.5)).toBeUndefined();
  });
});

describe('mediana', () => {
  it('ordena antes de calcular', () => {
    expect(mediana([30, 10, 20])).toBe(20);
  });
});

describe('montarFaixaDeObservacoes', () => {
  it('é undefined sem observações válidas', () => {
    expect(montarFaixaDeObservacoes([], 'un')).toBeUndefined();
    expect(montarFaixaDeObservacoes([obs(0), obs(-1)], 'un')).toBeUndefined();
  });

  it('monta mediana/percentis a partir das observações regulares', () => {
    const faixa = montarFaixaDeObservacoes([obs(10), obs(20), obs(30), obs(40)], 'un');
    expect(faixa).toMatchObject({
      mediana: 25,
      p25: 17.5,
      p75: 32.5,
      nObservacoes: 4,
      unidadeBase: 'un',
    });
    expect(faixa?.menorPromocional).toBeUndefined();
  });

  it('segrega a promoção: o típico ignora o preço promocional, mas conta na base', () => {
    // Regulares 8/8/9; uma promoção a 5 não puxa o típico para baixo.
    const faixa = montarFaixaDeObservacoes([obs(8), obs(8), obs(9), obs(5, true)], 'L');
    expect(faixa?.mediana).toBe(8);
    expect(faixa?.menorPromocional).toBe(5);
    expect(faixa?.nObservacoes).toBe(4);
    // O preço regular de 8,50 cai dentro da faixa, não "caro" por causa da promoção.
    expect(classificarPreco(8.5, faixa!)).toBe('na_media');
  });

  it('usa o instante mais recente como atualizadoEm', () => {
    const faixa = montarFaixaDeObservacoes(
      [obs(10, false, '2026-01-10'), obs(12, false, '2026-03-02'), obs(11, false, '2026-02-01')],
      'kg',
    );
    expect(faixa?.atualizadoEm).toBe('2026-03-02');
  });

  it('degrada para usar promoções quando não há nenhuma observação regular', () => {
    const faixa = montarFaixaDeObservacoes([obs(5, true), obs(6, true)], 'un');
    expect(faixa?.mediana).toBe(5.5);
    expect(faixa?.menorPromocional).toBe(5);
    expect(faixa?.nObservacoes).toBe(2);
  });
});
