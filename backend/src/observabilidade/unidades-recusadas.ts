/**
 * C3.4 — Leitura do ranking DURÁVEL de abreviações de unidade que o mapa de
 * normalização não reconhece.
 *
 * A escrita já existia (`Telemetria.registrarUnidadeRecusada` → linha
 * `unidade_recusada:<CHAVE>` em `telemetria_parsing`). O que faltava era poder
 * LER: o `/metricas` servia só o contador em memória, que zera a cada restart —
 * e no free tier a instância dorme várias vezes ao dia. Na prática o número que
 * deveria dizer "ensine esta abreviação ao mapa" nunca acumulava amostra.
 *
 * Segue a separação de portas de `telemetria.ts`: aqui é só LEITURA, e o
 * `Telemetria` (escrita) segue sem saber que este módulo existe.
 */

/** Uma abreviação que derrubou itens do pool, com onde e quanto. */
export interface UnidadeRecusada {
  /** Chave já normalizada por `chaveUnidade` — é o que se acrescenta ao mapa. */
  unidade: string;
  /** Itens perdidos na janela consultada. */
  total: number;
  /** UFs em que apareceu — abreviação de uma UF só costuma ser de um ERP local. */
  ufs: string[];
}

export interface FonteUnidadesRecusadas {
  /** Mais frequentes primeiro. Lança se o banco falhar (o chamador decide). */
  ranking(dias?: number): Promise<UnidadeRecusada[]>;
}

/** Porta mínima do cliente Postgres — subconjunto estrutural de `SupabaseClient.rpc`. */
export interface ClienteRpcUnidadesRecusadas {
  rpc(
    fn: 'unidades_recusadas_recentes',
    args: { p_dias: number },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Janela padrão: um mês cobre a sazonalidade de compra sem virar arqueologia. */
const DIAS_PADRAO = 30;

export class RankingUnidadesRecusadas implements FonteUnidadesRecusadas {
  constructor(private readonly db: ClienteRpcUnidadesRecusadas) {}

  async ranking(dias: number = DIAS_PADRAO): Promise<UnidadeRecusada[]> {
    const { data, error } = await this.db.rpc('unidades_recusadas_recentes', { p_dias: dias });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data.map(normalizarLinha).filter((l) => l !== undefined) : [];
  }
}

/**
 * O `bigint` do `sum()` volta como number ou string conforme o driver — coagir
 * aqui evita que o painel some texto com número mais adiante.
 */
function normalizarLinha(linha: unknown): UnidadeRecusada | undefined {
  if (typeof linha !== 'object' || linha === null) return undefined;
  const { unidade, total, ufs } = linha as Record<string, unknown>;
  if (typeof unidade !== 'string' || !unidade) return undefined;
  return {
    unidade,
    total: Number(total) || 0,
    ufs: Array.isArray(ufs) ? ufs.filter((uf): uf is string => typeof uf === 'string') : [],
  };
}
