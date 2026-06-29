/**
 * C10.3 — Lançamento faseado por UF.
 *
 * Ter parser para um estado NÃO basta para atendê-lo em produção: o lançamento é
 * gradual (RJ → SP → …, docs/07 Fase 4). Este controle é a fonte de verdade de
 * QUAIS UFs estão habilitadas agora. O processador (worker) consulta `habilitada`
 * antes de parsear: uma UF com parser, mas ainda NÃO habilitada, fica
 * `qr_capturado` — exatamente como uma UF sem parser — e o reprocessamento
 * retroativo (C2.5) a recupera quando ela for ligada. Nenhum cupom é perdido no
 * caminho; só fica represado até a sua vez no rollout.
 */

export interface Rollout {
  /** A UF está habilitada para processamento agora? */
  habilitada(uf: string): boolean;
  /** UFs habilitadas (ordenadas, para logs/telemetria estáveis). */
  ufs(): string[];
}

/** UFs do lançamento inicial (docs/07 — Fase 4: RJ + SP). */
export const UFS_PADRAO = ['RJ', 'SP'] as const;

const normalizar = (uf: string): string => uf.trim().toUpperCase();

export class ControleRollout implements Rollout {
  private readonly habilitadas: Set<string>;

  constructor(ufs: Iterable<string>) {
    this.habilitadas = new Set([...ufs].map(normalizar).filter((u) => u.length > 0));
  }

  habilitada(uf: string): boolean {
    return this.habilitadas.has(normalizar(uf));
  }

  ufs(): string[] {
    return [...this.habilitadas].sort();
  }
}

/** Rollout permissivo (todas as UFs) — padrão para testes/fluxos sem gate. */
export const ROLLOUT_TUDO: Rollout = {
  habilitada: () => true,
  ufs: () => [],
};

/**
 * Lê a lista de UFs habilitadas de uma string `UFS_HABILITADAS` (ex.: "RJ,SP").
 * Vazia/ausente → lançamento padrão (RJ + SP), para nunca subir o backend sem
 * atender estado nenhum por esquecer a variável.
 */
export function parseUfsHabilitadas(raw?: string): string[] {
  const lista = (raw ?? '')
    .split(',')
    .map(normalizar)
    .filter((u) => u.length > 0);
  return lista.length > 0 ? lista : [...UFS_PADRAO];
}
