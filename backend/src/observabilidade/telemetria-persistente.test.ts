/**
 * C10.2 — A telemetria persistente conta em memória (fonte do `/metricas`) E
 * grava no Postgres; e uma falha do banco NUNCA derruba quem registrou.
 */

import { describe, expect, it, vi } from 'vitest';

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

  it('falha do banco vira log — não lança e a memória segue contando', async () => {
    const erroLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db: ClienteRpcTelemetria = {
      rpc: () => Promise.reject(new Error('banco fora')),
    };
    const telemetria = new TelemetriaPersistente(db);

    expect(() => telemetria.registrarParsing('RJ', 'processado')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // dá vez ao catch assíncrono

    expect(telemetria.snapshot().totais.processado).toBe(1);
    expect(erroLog).toHaveBeenCalled();
    erroLog.mockRestore();
  });

  it('erro retornado pelo PostgREST (sem exceção) também só vira log', async () => {
    const erroLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db: ClienteRpcTelemetria = {
      rpc: () => Promise.resolve({ error: { message: 'permission denied' } }),
    };
    const telemetria = new TelemetriaPersistente(db);

    telemetria.registrarParsing('SP', 'falha_permanente');
    await new Promise((r) => setTimeout(r, 0));

    expect(telemetria.snapshot().porUf.SP).toEqual({ falha_permanente: 1 });
    expect(erroLog).toHaveBeenCalledWith(expect.stringContaining('SP/falha_permanente'));
    erroLog.mockRestore();
  });
});
