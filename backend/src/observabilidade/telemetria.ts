/**
 * C10.2 — Observabilidade do parsing por estado.
 *
 * O parsing é o ponto mais frágil da operação (cada portal SEFAZ muda layout por
 * conta própria), então a operação precisa enxergar, POR UF, quantos cupons foram
 * processados, falharam ou ficaram represados. Duas portas, propositalmente
 * separadas: `Telemetria` é a ESCRITA (o domínio só registra desfechos, sem saber
 * para onde vão); `FonteMetricas` é a LEITURA (o endpoint `/metricas` expõe).
 */

export type EventoParsing =
  | 'processado' // parseado e anonimizado com sucesso
  | 'falha_permanente' // layout/QR inválido — exige corrigir o parser, não dá retry
  | 'transitorio_esgotado' // portal fora do ar além do limite de retries da fila
  | 'sem_parser' // UF sem parser — represado p/ reprocessamento retroativo (C2.5)
  | 'uf_nao_habilitada' // tem parser, mas fora do rollout atual (C10.3)
  | 'erro_portal' // portal recusou a verificação (reCAPTCHA) — app recarrega e re-tenta (C2.6)
  | 'pool_deduplicado'; // observações retidas: chave já publicada por outra conta (C9.2.1)

export interface Telemetria {
  /** Registra o desfecho do parsing de um cupom. `uf` ausente → "desconhecida". */
  registrarParsing(uf: string | undefined, evento: EventoParsing): void;
}

export interface SnapshotTelemetria {
  geradoEm: string;
  /** Soma de cada evento somando todas as UFs. */
  totais: Partial<Record<EventoParsing, number>>;
  /** Contadores por UF: `{ RJ: { processado: 10, falha_permanente: 1 } }`. */
  porUf: Record<string, Partial<Record<EventoParsing, number>>>;
}

export interface FonteMetricas {
  snapshot(): SnapshotTelemetria;
}

/** Telemetria no-op — padrão para testes e fluxos que não observam. */
export const telemetriaNula: Telemetria = { registrarParsing: () => {} };
