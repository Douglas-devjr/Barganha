/**
 * C10.2 — A telemetria persistente conta em memória (fonte do `/metricas`) E
 * grava no Postgres; e uma falha do banco NUNCA derruba quem registrou.
 */

import { describe, expect, it } from 'vitest';

import { TelemetriaPersistente, type ClienteRpcTelemetria } from './telemetria-persistente';

function clienteQueGrava(): { db: ClienteRpcTelemetria; chamadas: unknown[][] } {
  const chamadas: unknown[][] = [];
  const db: ClienteRpcTelemetria = {
    rpc: (fn, args) => {
      chamadas.push([fn, args]);
      return Promise.resolve({ error: null });
    },
  };
  return { db, chamadas };
}

describe('TelemetriaPersistente (C10.2)', () => {
  it('conta em memória e persiste com a MESMA chave normalizada de UF', async () => {
    const { db, chamadas } = clienteQueGrava();
    const telemetria = new TelemetriaPersistente(db);

    telemetria.registrarParsing('rj', 'processado');
    telemetria.registrarParsing(undefined, 'erro_portal');
    await Promise.resolve(); // deixa os fire-and-forget assentarem

    expect(telemetria.snapshot().porUf).toEqual({
      RJ: { processado: 1 },
      desconhecida: { erro_portal: 1 },
    });
    expect(chamadas).toEqual([
      ['incrementar_telemetria_parsing', { p_uf: 'RJ', p_evento: 'processado' }],
      ['incrementar_telemetria_parsing', { p_uf: 'desconhecida', p_evento: 'erro_portal' }],
    ]);
  });

  it('snapshot saudável não acusa falha de persistência', async () => {
    const { db } = clienteQueGrava();
    const telemetria = new TelemetriaPersistente(db);

    telemetria.registrarParsing('RJ', 'processado');
    await new Promise((r) => setTimeout(r, 0));

    expect(telemetria.snapshot().saude).toEqual({ falhasPersistencia: 0 });
  });

  it('falha do banco não lança, a memória segue contando E o /metricas denuncia', async () => {
    const db: ClienteRpcTelemetria = {
      rpc: () => Promise.reject(new Error('banco fora')),
    };
    const telemetria = new TelemetriaPersistente(db);

    expect(() => telemetria.registrarParsing('RJ', 'processado')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // dá vez ao catch assíncrono

    expect(telemetria.snapshot().totais.processado).toBe(1);
    // O ponto do achado (f): antes a falha só ia para o console e o `/metricas`
    // seguia com cara de saudável. Agora o instrumento avisa que está cego.
    const saude = telemetria.snapshot().saude;
    expect(saude?.falhasPersistencia).toBe(1);
    expect(saude?.ultimaFalhaEm).toBeTruthy();
    expect(saude?.ultimaFalhaMotivo).toContain('banco fora');
  });

  it('erro retornado pelo PostgREST (sem exceção) também conta na saúde', async () => {
    const db: ClienteRpcTelemetria = {
      rpc: () => Promise.resolve({ error: { message: 'permission denied' } }),
    };
    const telemetria = new TelemetriaPersistente(db);

    telemetria.registrarParsing('SP', 'falha_permanente');
    await new Promise((r) => setTimeout(r, 0));

    expect(telemetria.snapshot().porUf.SP).toEqual({ falha_permanente: 1 });
    expect(telemetria.snapshot().saude?.falhasPersistencia).toBe(1);
    expect(telemetria.snapshot().saude?.ultimaFalhaMotivo).toContain('permission denied');
  });

  it('o motivo da falha é SANITIZADO antes de virar estado exposto', async () => {
    // O `/metricas` é lido por humanos da curadoria; o motivo vem de uma
    // mensagem de erro do driver, que pode carregar trecho de query — e query
    // aqui encosta em `chave_acesso` (docs/04).
    const db: ClienteRpcTelemetria = {
      rpc: () =>
        Promise.resolve({
          error: { message: 'falha na chave 33260612345678000199650010000000011000000016' },
        }),
    };
    const telemetria = new TelemetriaPersistente(db);

    telemetria.registrarParsing('RJ', 'processado');
    await new Promise((r) => setTimeout(r, 0));

    const motivo = telemetria.snapshot().saude?.ultimaFalhaMotivo ?? '';
    expect(motivo).not.toContain('33260612345678000199650010000000011000000016');
    expect(motivo).toContain('[REDIGIDO]');
  });
});
