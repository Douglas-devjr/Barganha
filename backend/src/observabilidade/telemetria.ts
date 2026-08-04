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
  /**
   * C3.4 — conta, por UF, uma unidade de venda que a NFC-e trouxe e que o mapa
   * de normalização não reconhece (nem como unidade direta, nem como prefixo
   * de embalagem múltipla) — o item cai do pool em silêncio. `unidadeChave` é
   * a chave já normalizada (`chaveUnidade`), então o valor aqui É a abreviação
   * que falta acrescentar ao mapa ao conferir notas reais de mais estados.
   */
  registrarUnidadeRecusada(uf: string | undefined, unidadeChave: string): void;
}

/**
 * Saúde da PRÓPRIA telemetria. Sem isto, se a gravação em `telemetria_parsing`
 * quebrasse, o `/metricas` seguiria mostrando os números da memória — com cara
 * de perfeitamente saudável — enquanto o histórico durável não gravava nada. O
 * instrumento precisa dizer quando ELE está quebrado.
 */
export interface SaudeTelemetria {
  /** Gravações no Postgres que falharam desde que o processo subiu. */
  falhasPersistencia: number;
  /** ISO da última falha, ausente se nunca falhou. */
  ultimaFalhaEm?: string;
  /** Motivo da última falha, já sanitizado. */
  ultimaFalhaMotivo?: string;
}

export interface SnapshotTelemetria {
  geradoEm: string;
  /** Soma de cada evento somando todas as UFs. */
  totais: Partial<Record<EventoParsing, number>>;
  /** Contadores por UF: `{ RJ: { processado: 10, falha_permanente: 1 } }`. */
  porUf: Record<string, Partial<Record<EventoParsing, number>>>;
  /**
   * Unidades cruas rejeitadas por UF, da mais para a menos frequente —
   * `{ RJ: { CX: 12, PCT: 3 } }`. É a lista de abreviações que faltam no mapa
   * (C3.4); vazio quando nenhuma UF teve item derrubado por unidade desconhecida.
   */
  unidadesRecusadas: Record<string, Record<string, number>>;
  /** Ausente no coletor puramente em memória (não há o que persistir). */
  saude?: SaudeTelemetria;
}

export interface FonteMetricas {
  snapshot(): SnapshotTelemetria;
}

/** Telemetria no-op — padrão para testes e fluxos que não observam. */
export const telemetriaNula: Telemetria = {
  registrarParsing: () => {},
  registrarUnidadeRecusada: () => {},
};
