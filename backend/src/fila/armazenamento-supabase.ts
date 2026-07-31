/**
 * C2.1 — Armazenamento da fila durável no Postgres. Tradução direta da porta
 * `ArmazenamentoFila` para as RPCs de `fila_processamento` (migração
 * 20260729100000). Nenhuma decisão de política mora aqui: backoff, concorrência
 * e teto de tentativas são da `FilaPostgres`.
 *
 * Por que RPC e não `from('fila_processamento')`: a reivindicação exige
 * `for update skip locked` num único statement — é ELE que garante que duas
 * instâncias nunca peguem a mesma tarefa. Pelo PostgREST isso não se expressa.
 */

import os from 'node:os';

import type {
  ArmazenamentoFila,
  EstadoFila,
  FalhaTarefa,
  TarefaProcessamento,
  TarefaReivindicada,
} from './tipos';

/**
 * Porta mínima do cliente Postgres usada aqui — subconjunto estrutural do
 * `SupabaseClient.rpc`, para o teste injetar um fake sem carregar o SDK (mesmo
 * desenho de `telemetria-persistente.ts`).
 */
export interface ClienteRpcFila {
  rpc(
    fn: 'fila_enfileirar' | 'fila_reivindicar' | 'fila_concluir' | 'fila_falhar' | 'fila_estado',
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/**
 * Prazo da lease em segundos. Tem de ser MAIOR que o pior caso de um parse
 * (consulta ao portal da SEFAZ + parsing): vencer antes do worker terminar faz
 * outra instância retomar a mesma tarefa. 5 min dá folga de sobra.
 */
export const LEASE_PADRAO_SEG = 300;

export interface OpcoesArmazenamentoFila {
  leaseSeg?: number;
  /** Quem reivindicou — vai para `reivindicado_por`, só para diagnóstico. */
  worker?: string;
}

/** Linha devolvida por `fila_reivindicar` (nomes do banco, snake_case). */
interface LinhaReivindicada {
  cupom_id: string;
  uf: string | null;
  tentativas: number;
}

interface LinhaEstado {
  pendentes: number;
  em_curso: number;
  esgotadas: number;
}

export class ArmazenamentoFilaSupabase implements ArmazenamentoFila {
  private readonly leaseSeg: number;
  private readonly worker: string;

  constructor(
    private readonly db: ClienteRpcFila,
    opcoes: OpcoesArmazenamentoFila = {},
  ) {
    this.leaseSeg = Math.max(1, opcoes.leaseSeg ?? LEASE_PADRAO_SEG);
    this.worker = opcoes.worker ?? identidadeProcesso();
  }

  async enfileirar(tarefa: TarefaProcessamento): Promise<void> {
    const r = await this.db.rpc('fila_enfileirar', {
      p_cupom_id: tarefa.cupomId,
      p_uf: tarefa.uf ?? null,
      p_lease_seg: this.leaseSeg,
    });
    if (r.error) falhar('enfileiramento na fila durável', r.error);
  }

  async reivindicar(limite: number): Promise<TarefaReivindicada[]> {
    const r = await this.db.rpc('fila_reivindicar', {
      p_limite: limite,
      p_lease_seg: this.leaseSeg,
      p_worker: this.worker,
    });
    if (r.error) falhar('reivindicação de tarefas', r.error);
    const linhas = (r.data ?? []) as LinhaReivindicada[];
    return linhas.map((l) => ({
      cupomId: l.cupom_id,
      ...(l.uf ? { uf: l.uf.trim() } : {}),
      tentativas: l.tentativas,
    }));
  }

  async concluir(cupomId: string): Promise<void> {
    const r = await this.db.rpc('fila_concluir', { p_cupom_id: cupomId });
    if (r.error) falhar('conclusão de tarefa da fila', r.error);
  }

  async falhar(cupomId: string, falha: FalhaTarefa): Promise<boolean> {
    const r = await this.db.rpc('fila_falhar', {
      p_cupom_id: cupomId,
      // `int` no banco: ms fracionário viria do backoff calculado, não do relógio.
      p_espera_ms: Math.round(falha.esperaMs),
      p_tentativas_max: falha.tentativasMax,
      p_erro: falha.erro ?? null,
    });
    if (r.error) falhar('devolução de tarefa à fila', r.error);
    return r.data === true;
  }

  async estado(): Promise<EstadoFila> {
    const r = await this.db.rpc('fila_estado', { p_lease_seg: this.leaseSeg });
    if (r.error) falhar('leitura do estado da fila', r.error);
    // `returns table` devolve UMA linha; ausência = fila vazia recém-migrada.
    const linha = ((r.data ?? []) as LinhaEstado[])[0];
    return {
      pendentes: linha?.pendentes ?? 0,
      emCurso: linha?.em_curso ?? 0,
      esgotadas: linha?.esgotadas ?? 0,
    };
  }
}

/**
 * Identidade desta instância, para `reivindicado_por` responder "quem está com
 * esta tarefa" quando houver mais de um processo. Diagnóstico apenas — a
 * exclusão mútua é do banco, não deste nome.
 */
function identidadeProcesso(): string {
  return `${os.hostname()}:${process.pid}`;
}

/** Erro do PostgREST nunca vaza cru: só a operação e a mensagem do banco. */
function falhar(operacao: string, erro: { message: string; code?: string }): never {
  const codigo = erro.code ? ` (${erro.code})` : '';
  throw new Error(`Falha na ${operacao}${codigo}: ${erro.message}`);
}
