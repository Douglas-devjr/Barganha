import { describe, expect, it } from 'vitest';

import {
  type CoberturaPorCupom,
  LIMIAR_GATILHO,
  calcularCobertura,
  formatarAvisoCobertura,
} from './cobertura-tipico';

const linha = (p: Partial<CoberturaPorCupom> = {}): CoberturaPorCupom => ({
  cupomId: 'c1',
  totalItens: 10,
  itensComTipico: 0,
  ...p,
});

describe('calcularCobertura (C8.4.1)', () => {
  it('lista vazia: tudo zerado, gatilho não atingido', () => {
    const r = calcularCobertura([]);
    expect(r).toEqual({
      cuponsAvaliados: 0,
      cuponsElegiveis: 0,
      coberturaMedianaPorCupom: 0,
      coberturaAgregada: 0,
      atingiuGatilho: false,
    });
  });

  it('cupom único abaixo do limiar', () => {
    const r = calcularCobertura([linha({ totalItens: 10, itensComTipico: 3 })]);
    expect(r.coberturaMedianaPorCupom).toBeCloseTo(0.3);
    expect(r.coberturaAgregada).toBeCloseTo(0.3);
    expect(r.atingiuGatilho).toBe(false);
  });

  it('cupom único acima do limiar', () => {
    const r = calcularCobertura([linha({ totalItens: 10, itensComTipico: 8 })]);
    expect(r.coberturaMedianaPorCupom).toBeCloseTo(0.8);
    expect(r.atingiuGatilho).toBe(true);
  });

  it('mediana com número par de cupons — interpola entre os dois centrais', () => {
    const r = calcularCobertura([
      linha({ cupomId: 'a', totalItens: 10, itensComTipico: 0 }), // 0.0
      linha({ cupomId: 'b', totalItens: 10, itensComTipico: 4 }), // 0.4
      linha({ cupomId: 'c', totalItens: 10, itensComTipico: 6 }), // 0.6
      linha({ cupomId: 'd', totalItens: 10, itensComTipico: 10 }), // 1.0
    ]);
    // mediana de [0, 0.4, 0.6, 1.0] = (0.4 + 0.6) / 2 = 0.5
    expect(r.coberturaMedianaPorCupom).toBeCloseTo(0.5);
    expect(r.atingiuGatilho).toBe(false); // 0.5 < 0.6
  });

  it('cupom com totalItens: 0 conta em cuponsAvaliados mas não contamina mediana/agregada', () => {
    const r = calcularCobertura([
      linha({ cupomId: 'vazio', totalItens: 0, itensComTipico: 0 }),
      linha({ cupomId: 'cheio', totalItens: 10, itensComTipico: 10 }),
    ]);
    expect(r.cuponsAvaliados).toBe(2);
    expect(r.cuponsElegiveis).toBe(1);
    expect(r.coberturaMedianaPorCupom).toBeCloseTo(1);
    expect(r.coberturaAgregada).toBeCloseTo(1);
  });

  it('coberturaAgregada é o total de itens com típico sobre o total de itens (não pondera por cupom)', () => {
    const r = calcularCobertura([
      linha({ cupomId: 'a', totalItens: 100, itensComTipico: 100 }), // cupom grande, 100%
      linha({ cupomId: 'b', totalItens: 1, itensComTipico: 0 }), // cupom pequeno, 0%
    ]);
    // agregada: 100/101 ~ 0.99 (puxada pelo cupom grande)
    expect(r.coberturaAgregada).toBeCloseTo(100 / 101);
    // mediana por cupom: mediana([1, 0]) = 0.5 (não é puxada pelo tamanho)
    expect(r.coberturaMedianaPorCupom).toBeCloseTo(0.5);
  });

  it('atingiuGatilho: borda exata (>=) conta como atingido', () => {
    const r = calcularCobertura([linha({ totalItens: 100, itensComTipico: 60 })]);
    expect(r.coberturaMedianaPorCupom).toBeCloseTo(LIMIAR_GATILHO);
    expect(r.atingiuGatilho).toBe(true);
  });

  it('atingiuGatilho: logo abaixo da borda não atinge', () => {
    const r = calcularCobertura([linha({ totalItens: 100, itensComTipico: 59 })]);
    expect(r.atingiuGatilho).toBe(false);
  });
});

/* Este gatilho, ao contrário dos parâmetros de calibração, não se desarma
   sozinho: cobertura que cruzou 60% fica cruzada. O que se protege aqui é o
   silenciador — sem ele o aviso pipocaria todo mês anos depois da UI pronta. */
describe('aviso do gatilho (o que o cron dispara)', () => {
  const acima = calcularCobertura([linha({ totalItens: 10, itensComTipico: 8 })]);
  const abaixo = calcularCobertura([linha({ totalItens: 10, itensComTipico: 3 })]);

  it('gatilho não atingido não avisa', () => {
    expect(formatarAvisoCobertura(abaixo, false)).toBeUndefined();
  });

  it('gatilho atingido e UI ainda não entregue avisa, dizendo como silenciar', () => {
    const aviso = formatarAvisoCobertura(acima, false);
    expect(aviso).toContain('80%');
    expect(aviso).toContain('UI_ECONOMIA_REAL_ENTREGUE');
  });

  it('UI já entregue silencia o aviso mesmo com o gatilho atingido', () => {
    expect(formatarAvisoCobertura(acima, true)).toBeUndefined();
  });
});
