import { describe, expect, it } from 'vitest';

import { dadoRecente, idadeEmDias, MAX_IDADE_TIPICO_DIAS } from './frescor';

const DIA_MS = 86_400_000;
const AGORA = new Date('2026-07-29T12:00:00.000Z');
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * DIA_MS).toISOString();

describe('frescor do típico (C12.1)', () => {
  it('mede a idade em dias a partir da observação', () => {
    expect(idadeEmDias(diasAtras(10), AGORA)).toBeCloseTo(10);
    expect(idadeEmDias(AGORA.toISOString(), AGORA)).toBe(0);
  });

  it('data no futuro não vira idade negativa', () => {
    // Relógio do aparelho adiantado não pode gerar "idade -3 dias".
    expect(idadeEmDias(new Date(AGORA.getTime() + 3 * DIA_MS).toISOString(), AGORA)).toBe(0);
  });

  it('sem data ou com data inválida a idade é DESCONHECIDA, não zero', () => {
    expect(idadeEmDias(undefined, AGORA)).toBeUndefined();
    expect(idadeEmDias('', AGORA)).toBeUndefined();
    expect(idadeEmDias('ontem', AGORA)).toBeUndefined();
  });

  it('idade desconhecida NÃO é recente — nunca herda confiança', () => {
    // A trava do selo "MAIS BARATO": linha antiga, sem `observado_em_max`, não
    // pode passar por dado fresco só porque ninguém sabe a idade dela.
    expect(dadoRecente(undefined, AGORA)).toBe(false);
    expect(dadoRecente('qualquer coisa', AGORA)).toBe(false);
  });

  it('recente até o limiar, velho depois dele', () => {
    expect(dadoRecente(diasAtras(0), AGORA)).toBe(true);
    expect(dadoRecente(diasAtras(MAX_IDADE_TIPICO_DIAS), AGORA)).toBe(true);
    expect(dadoRecente(diasAtras(MAX_IDADE_TIPICO_DIAS + 1), AGORA)).toBe(false);
  });

  it('aceita limiar próprio (calibração por tela)', () => {
    expect(dadoRecente(diasAtras(10), AGORA, 7)).toBe(false);
    expect(dadoRecente(diasAtras(10), AGORA, 14)).toBe(true);
  });

  it('o limiar acompanha a meia-vida do decaimento (docs/06)', () => {
    // Trava de calibração: subir isto é decidir que preço de mais de um mês
    // ainda descreve a loja de hoje.
    expect(MAX_IDADE_TIPICO_DIAS).toBeLessThanOrEqual(30);
  });
});
