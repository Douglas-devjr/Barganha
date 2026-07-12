/** C12.2 — Sequência de semanas e selos a partir das datas de captura. */

import { describe, expect, it } from 'vitest';

import { calcularContribuicao } from './gamificacao';

// Sexta 10/07/2026 12:00 local — semana ISO começa na segunda 06/07.
const AGORA = new Date(2026, 6, 10, 12, 0, 0);

const dia = (ano: number, mes1a12: number, dia: number): string =>
  new Date(ano, mes1a12 - 1, dia, 10, 0, 0).toISOString();

describe('calcularContribuicao (C12.2)', () => {
  it('conta sequência de semanas consecutivas com cupom', () => {
    const r = calcularContribuicao(
      [dia(2026, 6, 24), dia(2026, 6, 29), dia(2026, 7, 7)], // 3 semanas seguidas
      AGORA,
    );
    expect(r.sequenciaSemanas).toBe(3);
    expect(r.cuponsNaSemana).toBe(1);
    expect(r.totalCupons).toBe(3);
  });

  it('semana corrente ainda sem cupom NÃO quebra a sequência', () => {
    const r = calcularContribuicao([dia(2026, 6, 29), dia(2026, 7, 2)], AGORA); // só semana passada
    expect(r.sequenciaSemanas).toBe(1);
    expect(r.cuponsNaSemana).toBe(0);
  });

  it('buraco de uma semana zera a sequência antiga', () => {
    const r = calcularContribuicao([dia(2026, 6, 15), dia(2026, 7, 7)], AGORA); // pulou 2 semanas
    expect(r.sequenciaSemanas).toBe(1);
  });

  it('selos: thresholds de volume e semana cheia', () => {
    const dez = Array.from({ length: 10 }, (_, i) => dia(2026, 7, 6 + (i % 3))); // 10 na mesma semana
    const r = calcularContribuicao(dez, AGORA);
    const porId = new Map(r.selos.map((s) => [s.id, s.conquistado]));
    expect(porId.get('primeira-nota')).toBe(true);
    expect(porId.get('cacador')).toBe(true);
    expect(porId.get('veterano')).toBe(false);
    expect(porId.get('semana-cheia')).toBe(true);
    expect(porId.get('ritmo')).toBe(false);
  });

  it('sem cupons: tudo zerado e nenhum selo', () => {
    const r = calcularContribuicao([], AGORA);
    expect(r).toMatchObject({ totalCupons: 0, cuponsNaSemana: 0, sequenciaSemanas: 0 });
    expect(r.selos.every((s) => !s.conquistado)).toBe(true);
  });

  it('data futura (relógio torto) é ignorada', () => {
    const r = calcularContribuicao([dia(2026, 8, 1)], AGORA);
    expect(r.totalCupons).toBe(0);
  });
});
