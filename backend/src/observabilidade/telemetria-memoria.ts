/**
 * Coletor de telemetria em memória (C10.2). Suficiente para um processo único; na
 * infra distribuída (C10) troca-se por um exportador (Prometheus/StatsD/OTel) sem
 * o domínio perceber — ele só conhece a porta `Telemetria`. Os contadores são
 * esparsos: só aparecem no snapshot os eventos que de fato ocorreram.
 */

import type { EventoParsing, FonteMetricas, SnapshotTelemetria, Telemetria } from './telemetria';

const UF_DESCONHECIDA = 'desconhecida';

export class TelemetriaMemoria implements Telemetria, FonteMetricas {
  private readonly porUf = new Map<string, Map<EventoParsing, number>>();

  registrarParsing(uf: string | undefined, evento: EventoParsing): void {
    const chave = (uf ?? '').trim().toUpperCase() || UF_DESCONHECIDA;
    const eventos = this.porUf.get(chave) ?? new Map<EventoParsing, number>();
    eventos.set(evento, (eventos.get(evento) ?? 0) + 1);
    this.porUf.set(chave, eventos);
  }

  snapshot(): SnapshotTelemetria {
    const porUf: SnapshotTelemetria['porUf'] = {};
    const totais: Partial<Record<EventoParsing, number>> = {};
    for (const uf of [...this.porUf.keys()].sort()) {
      const eventos = this.porUf.get(uf);
      if (!eventos) continue;
      const contagens: Partial<Record<EventoParsing, number>> = {};
      for (const [evento, n] of eventos) {
        contagens[evento] = n;
        totais[evento] = (totais[evento] ?? 0) + n;
      }
      porUf[uf] = contagens;
    }
    return { geradoEm: new Date().toISOString(), totais, porUf };
  }
}
