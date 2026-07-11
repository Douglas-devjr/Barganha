/**
 * C10.2 — Telemetria com persistência. Decora a `TelemetriaMemoria` (que segue
 * alimentando o `/metricas` do processo) e ainda incrementa o contador diário
 * em `telemetria_parsing` no Postgres, para o histórico sobreviver a
 * restart/deploy — essencial no free tier, onde a instância dorme e o contador
 * em memória zera várias vezes ao dia.
 *
 * A escrita é BEST-EFFORT e não-bloqueante: telemetria nunca pode derrubar nem
 * atrasar a ingestão. Falha vira log; o contador em memória segue valendo.
 */

import type { EventoParsing, FonteMetricas, SnapshotTelemetria, Telemetria } from './telemetria';
import { TelemetriaMemoria } from './telemetria-memoria';

/**
 * Porta mínima do cliente Postgres usada aqui — subconjunto estrutural do
 * `SupabaseClient.rpc`, para o teste injetar um fake sem carregar o SDK.
 */
export interface ClienteRpcTelemetria {
  rpc(
    fn: 'incrementar_telemetria_parsing',
    args: { p_uf: string; p_evento: string },
  ): PromiseLike<{ error: { message: string } | null }>;
}

const UF_DESCONHECIDA = 'desconhecida';

export class TelemetriaPersistente implements Telemetria, FonteMetricas {
  private readonly memoria = new TelemetriaMemoria();

  constructor(private readonly db: ClienteRpcTelemetria) {}

  registrarParsing(uf: string | undefined, evento: EventoParsing): void {
    this.memoria.registrarParsing(uf, evento);
    // Mesma normalização da memória — as duas fontes contam sob a mesma chave.
    const chave = (uf ?? '').trim().toUpperCase() || UF_DESCONHECIDA;
    void Promise.resolve(
      this.db.rpc('incrementar_telemetria_parsing', { p_uf: chave, p_evento: evento }),
    )
      .then((r) => {
        if (r.error) {
          console.error(`[telemetria] falha ao persistir ${chave}/${evento}: ${r.error.message}`);
        }
      })
      .catch((erro: unknown) => {
        console.error(`[telemetria] falha ao persistir ${chave}/${evento}:`, erro);
      });
  }

  snapshot(): SnapshotTelemetria {
    return this.memoria.snapshot();
  }
}
