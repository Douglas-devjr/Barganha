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
  private readonly unidadesRecusadasPorUf = new Map<string, Map<string, number>>();

  registrarParsing(uf: string | undefined, evento: EventoParsing): void {
    const chave = (uf ?? '').trim().toUpperCase() || UF_DESCONHECIDA;
    const eventos = this.porUf.get(chave) ?? new Map<EventoParsing, number>();
    eventos.set(evento, (eventos.get(evento) ?? 0) + 1);
    this.porUf.set(chave, eventos);
  }

  registrarUnidadeRecusada(uf: string | undefined, unidadeChave: string): void {
    const chaveUf = (uf ?? '').trim().toUpperCase() || UF_DESCONHECIDA;
    const contagens = this.unidadesRecusadasPorUf.get(chaveUf) ?? new Map<string, number>();
    contagens.set(unidadeChave, (contagens.get(unidadeChave) ?? 0) + 1);
    this.unidadesRecusadasPorUf.set(chaveUf, contagens);
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
    const unidadesRecusadas: SnapshotTelemetria['unidadesRecusadas'] = {};
    for (const uf of [...this.unidadesRecusadasPorUf.keys()].sort()) {
      const contagens = this.unidadesRecusadasPorUf.get(uf);
      if (!contagens) continue;
      const porUnidade: Record<string, number> = {};
      for (const [unidade, n] of [...contagens].sort((a, b) => b[1] - a[1])) {
        porUnidade[unidade] = n;
      }
      unidadesRecusadas[uf] = porUnidade;
    }
    return { geradoEm: new Date().toISOString(), totais, porUf, unidadesRecusadas };
  }
}
