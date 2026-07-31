import { describe, expect, it } from 'vitest';

import { mediana, montarFaixaDeObservacoes, quantil, type ObservacaoNormalizada } from './faixa';
import { classificarPreco } from './veredito';

function obs(preco: number, emPromocao = false, observadoEm = '2026-01-01'): ObservacaoNormalizada {
  return { precoNormalizado: preco, emPromocao, observadoEm };
}

/**
 * "Agora" logo depois das datas das fixtures. Precisa ser explícito: a faixa
 * pessoal agora carrega `observadoEmMaisRecente`, e o `classificarPreco` mede a
 * idade contra ele — com o relógio real, estas observações de janeiro/2026 já
 * estariam fora da janela da agregação e o veredito viria `sem_dados`. O teste é
 * sobre segregação de promoção, então a idade não pode ser variável aqui.
 */
const LOGO_DEPOIS = new Date('2026-01-05T00:00:00.000Z');

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
    expect(classificarPreco(8.5, faixa!, LOGO_DEPOIS)).toBe('na_media');
  });

  it('usa o instante mais recente como atualizadoEm', () => {
    const faixa = montarFaixaDeObservacoes(
      [obs(10, false, '2026-01-10'), obs(12, false, '2026-03-02'), obs(11, false, '2026-02-01')],
      'kg',
    );
    expect(faixa?.atualizadoEm).toBe('2026-03-02');
  });

  it('também expõe a idade do PREÇO — aqui as duas datas coincidem', () => {
    // Na faixa pessoal a conta é feita na hora sobre as próprias compras, então
    // "quando calculei" e "de quando é o dado" são o mesmo instante. A UI lê
    // `observadoEmMaisRecente` sem saber de qual ângulo a faixa veio; se este
    // lado não preenchesse, a Verificar diria "sem data" para quem TEM histórico.
    const faixa = montarFaixaDeObservacoes(
      [obs(10, false, '2026-01-10'), obs(12, false, '2026-03-02')],
      'kg',
    );
    expect(faixa?.observadoEmMaisRecente).toBe('2026-03-02');
    expect(faixa?.observadoEmMaisRecente).toBe(faixa?.atualizadoEm);
  });

  it('degrada para usar promoções quando não há nenhuma observação regular', () => {
    const faixa = montarFaixaDeObservacoes([obs(5, true), obs(6, true)], 'un');
    expect(faixa?.mediana).toBe(5.5);
    expect(faixa?.menorPromocional).toBe(5);
    expect(faixa?.nObservacoes).toBe(2);
  });
});
