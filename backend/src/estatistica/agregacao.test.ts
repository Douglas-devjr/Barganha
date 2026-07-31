import { describe, expect, it } from 'vitest';

import { agregar, percentilPonderado, pesoTemporal, type ObservacaoAgregavel } from './agregacao';

const REF = new Date('2026-06-28T00:00:00.000Z');

/** Observação a `dias` atrás de REF. */
function obs(preco: number, dias: number, emPromocao = false): ObservacaoAgregavel {
  return {
    precoNormalizado: preco,
    emPromocao,
    observadoEm: new Date(REF.getTime() - dias * 86_400_000).toISOString(),
  };
}

describe('pesoTemporal (C3.2)', () => {
  it('idade 0 pesa 1 e cai pela metade a cada meia-vida', () => {
    expect(pesoTemporal(0, 30)).toBe(1);
    expect(pesoTemporal(30, 30)).toBeCloseTo(0.5, 10);
    expect(pesoTemporal(60, 30)).toBeCloseTo(0.25, 10);
  });

  it('futuro (idade negativa) pesa 1', () => {
    expect(pesoTemporal(-5, 30)).toBe(1);
  });
});

describe('percentilPonderado (C3.1)', () => {
  it('com pesos iguais, comporta-se como percentil contínuo', () => {
    const am = [10, 20, 30, 40].map((valor) => ({ valor, peso: 1 }));
    expect(percentilPonderado(am, 4, 0.5)).toBeCloseTo(25, 6);
  });

  it('uma amostra retorna o próprio valor', () => {
    expect(percentilPonderado([{ valor: 7, peso: 0.3 }], 0.3, 0.25)).toBe(7);
  });

  it('peso maior puxa a mediana para o valor mais pesado', () => {
    const am = [
      { valor: 10, peso: 0.1 },
      { valor: 20, peso: 10 },
    ];
    // Com peso ~100x, a mediana fica praticamente colada no valor pesado.
    const m = percentilPonderado(am, 10.1, 0.5);
    expect(m).toBeGreaterThan(19.5);
    expect(m).toBeLessThanOrEqual(20);
  });
});

describe('agregar (C3.1/C3.2/C3.6)', () => {
  it('calcula a faixa típica por mediana/percentis', () => {
    const dados = [obs(6.0, 1), obs(6.5, 1), obs(7.0, 1), obs(6.8, 1), obs(6.2, 1)];
    const r = agregar(dados, { referencia: REF });
    expect(r).toBeDefined();
    expect(r!.mediana).toBeCloseTo(6.5, 1);
    expect(r!.minimo).toBe(6.0);
    expect(r!.maximo).toBe(7.0);
    expect(r!.nObservacoes).toBe(5);
    expect(r!.menorPromocional).toBeUndefined();
  });

  it('descarta observações fora da janela (decaimento/validade)', () => {
    const dados = [obs(6.5, 1), obs(6.6, 1), obs(99, 400)]; // a de 400 dias sai
    const r = agregar(dados, { referencia: REF });
    expect(r!.maximo).toBe(6.6);
    expect(r!.nObservacoes).toBe(2);
  });

  it('segrega a promoção DECLARADA na NFC-e do típico', () => {
    const dados = [obs(8.0, 1), obs(8.2, 1), obs(7.8, 1), obs(5.0, 2, true)];
    const r = agregar(dados, { referencia: REF });
    // O típico fica em torno de 8; o R$5 não entra no cálculo.
    expect(r!.mediana).toBeGreaterThan(7.5);
    expect(r!.menorPromocional).toBe(5.0);
    expect(r!.nObservacoes).toBe(3);
  });

  it('detecta promoção ESTATÍSTICA (cerco IQR) sem o flag da NFC-e', () => {
    // Um preço muito abaixo do cacho regular vira promoção detectada.
    const dados = [
      obs(10, 1),
      obs(10.2, 1),
      obs(9.8, 1),
      obs(10.1, 1),
      obs(9.9, 1),
      obs(4.0, 1), // outlier baixo → promoção detectada
    ];
    const r = agregar(dados, { referencia: REF });
    expect(r!.menorPromocional).toBe(4.0);
    expect(r!.minimo).toBeGreaterThan(9); // o típico ignora o R$4
  });

  it('quando tudo é promoção, não esvazia: usa o conjunto como base', () => {
    const dados = [obs(5.0, 1, true), obs(5.2, 1, true)];
    const r = agregar(dados, { referencia: REF });
    expect(r).toBeDefined();
    expect(r!.nObservacoes).toBe(2);
    expect(r!.menorPromocional).toBe(5.0);
  });

  it('retorna undefined quando não há observação válida na janela', () => {
    expect(agregar([obs(6.5, 999)], { referencia: REF })).toBeUndefined();
    expect(agregar([], { referencia: REF })).toBeUndefined();
  });

  describe('idade do típico (observadoEmMaisRecente)', () => {
    it('é a data da observação mais nova da base', () => {
      const r = agregar([obs(6.0, 40), obs(6.5, 3), obs(7.0, 12)], { referencia: REF });
      expect(r!.observadoEmMaisRecente).toBe(obs(0, 3).observadoEm);
    });

    it('ignora a observação descartada pela janela', () => {
      // A de 400 dias é a "mais recente" de nada: nem entrou no cálculo.
      const r = agregar([obs(6.5, 20), obs(6.6, 25), obs(99, 400)], { referencia: REF });
      expect(r!.observadoEmMaisRecente).toBe(obs(0, 20).observadoEm);
    });

    it('promoção segregada não rejuvenesce o típico', () => {
      // O típico é dos regulares (de 60 dias atrás); a promoção de ontem foi
      // separada do cálculo, então não pode fazer o típico parecer de ontem.
      const dados = [obs(8.0, 60), obs(8.2, 60), obs(7.8, 60), obs(5.0, 1, true)];
      const r = agregar(dados, { referencia: REF });
      expect(r!.menorPromocional).toBe(5.0);
      expect(r!.observadoEmMaisRecente).toBe(obs(0, 60).observadoEm);
    });
  });
});
