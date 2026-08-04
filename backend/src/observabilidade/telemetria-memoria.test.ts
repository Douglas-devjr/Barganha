import { describe, expect, it } from 'vitest';

import { TelemetriaMemoria } from './telemetria-memoria';

describe('TelemetriaMemoria (C10.2 — parsing por estado)', () => {
  it('agrega contadores por UF e total por evento', () => {
    const tel = new TelemetriaMemoria();
    tel.registrarParsing('RJ', 'processado');
    tel.registrarParsing('RJ', 'processado');
    tel.registrarParsing('RJ', 'falha_permanente');
    tel.registrarParsing('SP', 'processado');

    const s = tel.snapshot();
    expect(s.porUf).toEqual({
      RJ: { processado: 2, falha_permanente: 1 },
      SP: { processado: 1 },
    });
    expect(s.totais).toEqual({ processado: 3, falha_permanente: 1 });
    expect(s.geradoEm).toBeTruthy();
  });

  it('UF ausente cai no bucket "desconhecida"', () => {
    const tel = new TelemetriaMemoria();
    tel.registrarParsing(undefined, 'transitorio_esgotado');
    expect(tel.snapshot().porUf).toEqual({ desconhecida: { transitorio_esgotado: 1 } });
  });

  it('snapshot de coletor vazio é estável (sem chaves)', () => {
    const s = new TelemetriaMemoria().snapshot();
    expect(s.porUf).toEqual({});
    expect(s.totais).toEqual({});
    expect(s.unidadesRecusadas).toEqual({});
  });

  it('C3.4 — conta unidade recusada por UF, da mais para a menos frequente', () => {
    const tel = new TelemetriaMemoria();
    tel.registrarUnidadeRecusada('RJ', 'XPTO');
    tel.registrarUnidadeRecusada('RJ', 'XPTO');
    tel.registrarUnidadeRecusada('RJ', 'ZBL');
    tel.registrarUnidadeRecusada(undefined, 'FOO');

    expect(tel.snapshot().unidadesRecusadas).toEqual({
      RJ: { XPTO: 2, ZBL: 1 },
      desconhecida: { FOO: 1 },
    });
  });
});
