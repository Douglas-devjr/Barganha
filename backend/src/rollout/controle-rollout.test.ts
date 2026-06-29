import { describe, expect, it } from 'vitest';

import { ControleRollout, parseUfsHabilitadas, ROLLOUT_TUDO, UFS_PADRAO } from './controle-rollout';

describe('ControleRollout (C10.3 — lançamento faseado)', () => {
  it('habilita só as UFs configuradas', () => {
    const rollout = new ControleRollout(['RJ']);
    expect(rollout.habilitada('RJ')).toBe(true);
    expect(rollout.habilitada('SP')).toBe(false);
  });

  it('normaliza UF (case/espacos) na configuração e na consulta', () => {
    const rollout = new ControleRollout([' rj ', 'sp']);
    expect(rollout.habilitada('rj')).toBe(true);
    expect(rollout.habilitada('Sp')).toBe(true);
    expect(rollout.ufs()).toEqual(['RJ', 'SP']);
  });

  it('ROLLOUT_TUDO habilita qualquer UF (sem gate)', () => {
    expect(ROLLOUT_TUDO.habilitada('MG')).toBe(true);
    expect(ROLLOUT_TUDO.habilitada('BA')).toBe(true);
  });
});

describe('parseUfsHabilitadas', () => {
  it('lê uma lista separada por vírgula e normaliza', () => {
    expect(parseUfsHabilitadas('rj, sp ,mg')).toEqual(['RJ', 'SP', 'MG']);
  });

  it('cai no lançamento padrão (RJ+SP) quando vazia/ausente', () => {
    expect(parseUfsHabilitadas(undefined)).toEqual([...UFS_PADRAO]);
    expect(parseUfsHabilitadas('')).toEqual([...UFS_PADRAO]);
    expect(parseUfsHabilitadas('  ,  ')).toEqual([...UFS_PADRAO]);
  });
});
