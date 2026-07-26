import { describe, expect, it } from 'vitest';

import {
  ehRemoto,
  escolherTimeout,
  JANELA_QUENTE_MS,
  TIMEOUT_FRIO_MS,
  TIMEOUT_QUENTE_MS,
} from './politica-timeout';

const AGORA = 1_800_000_000_000;

describe('escolherTimeout', () => {
  it('dá o teto longo ao primeiro contato — a instância pode estar hibernando', () => {
    expect(escolherTimeout({ remoto: true, ultimoContatoEm: null, agora: AGORA })).toBe(
      TIMEOUT_FRIO_MS,
    );
  });

  it('encurta enquanto a resposta recente prova que o servidor está acordado', () => {
    expect(escolherTimeout({ remoto: true, ultimoContatoEm: AGORA - 30_000, agora: AGORA })).toBe(
      TIMEOUT_QUENTE_MS,
    );
  });

  it('volta ao teto longo quando o silêncio passa da janela', () => {
    expect(
      escolherTimeout({ remoto: true, ultimoContatoEm: AGORA - JANELA_QUENTE_MS, agora: AGORA }),
    ).toBe(TIMEOUT_FRIO_MS);
  });

  it('mantém o teto curto no backend local: LAN não hiberna', () => {
    expect(escolherTimeout({ remoto: false, ultimoContatoEm: null, agora: AGORA })).toBe(
      TIMEOUT_QUENTE_MS,
    );
  });

  it('não encurta com relógio andando para trás', () => {
    expect(escolherTimeout({ remoto: true, ultimoContatoEm: AGORA + 60_000, agora: AGORA })).toBe(
      TIMEOUT_FRIO_MS,
    );
  });
});

describe('ehRemoto', () => {
  it('reconhece a base de produção', () => {
    expect(ehRemoto('https://barganha-api.onrender.com')).toBe(true);
  });

  it('trata o backend da LAN como local', () => {
    expect(ehRemoto('http://192.168.0.10:3000')).toBe(false);
  });
});
