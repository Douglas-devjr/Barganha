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

import { log } from './log';
import { sanitizarErro } from './sanitizar';
import type {
  EventoParsing,
  FonteMetricas,
  SaudeTelemetria,
  SnapshotTelemetria,
  Telemetria,
} from './telemetria';
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

  /** Contador da própria saúde — ver `SaudeTelemetria`. */
  private falhasPersistencia = 0;
  private ultimaFalhaEm?: string;
  private ultimaFalhaMotivo?: string;

  constructor(private readonly db: ClienteRpcTelemetria) {}

  registrarParsing(uf: string | undefined, evento: EventoParsing): void {
    this.memoria.registrarParsing(uf, evento);
    // Mesma normalização da memória — as duas fontes contam sob a mesma chave.
    const chave = (uf ?? '').trim().toUpperCase() || UF_DESCONHECIDA;
    void Promise.resolve(
      this.db.rpc('incrementar_telemetria_parsing', { p_uf: chave, p_evento: evento }),
    )
      .then((r) => {
        if (r.error) this.registrarFalha(chave, evento, new Error(r.error.message));
      })
      .catch((erro: unknown) => {
        this.registrarFalha(chave, evento, erro);
      });
  }

  /**
   * ACHADO (f): a falha ia só para o console. Agora ela também vira ESTADO
   * exposto no `/metricas` — quem olha o painel enxerga que o instrumento está
   * cego, em vez de confiar em números da memória que somem no próximo restart.
   */
  private registrarFalha(chave: string, evento: EventoParsing, erro: unknown): void {
    const { mensagem } = sanitizarErro(erro);
    this.falhasPersistencia += 1;
    this.ultimaFalhaEm = new Date().toISOString();
    this.ultimaFalhaMotivo = mensagem;
    // `error`: exige ação humana. Perder o histórico durável no free tier (onde a
    // instância dorme e a memória zera) é perder a série temporal de vez.
    log.error(
      { action: 'telemetria.persistencia_falhou', uf: chave, evento, erro: { mensagem } },
      'Falha ao persistir telemetria — o contador em memória segue valendo',
    );
  }

  snapshot(): SnapshotTelemetria {
    return { ...this.memoria.snapshot(), saude: this.saude() };
  }

  private saude(): SaudeTelemetria {
    return {
      falhasPersistencia: this.falhasPersistencia,
      ...(this.ultimaFalhaEm ? { ultimaFalhaEm: this.ultimaFalhaEm } : {}),
      ...(this.ultimaFalhaMotivo ? { ultimaFalhaMotivo: this.ultimaFalhaMotivo } : {}),
    };
  }
}
