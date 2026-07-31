/**
 * Portas da fila de processamento (C2.1). A ingestão só depende de `enfileirar`;
 * quem processa (worker) e ONDE a fila vive são detalhes do adaptador —
 * `FilaMemoria` (uma instância) ou `FilaPostgres` (durável, várias instâncias).
 */

export interface TarefaProcessamento {
  cupomId: string;
  /** UF do cupom (quando já conhecida na ingestão) — só p/ telemetria por estado (C10.2). */
  uf?: string;
}

export interface FilaProcessamento {
  enfileirar(tarefa: TarefaProcessamento): Promise<void>;
}

/**
 * Tarefa entregue por uma fila durável. `tentativas` é o contador JÁ incluindo
 * esta entrega — vem do banco, não da memória do processo, e é o que faz o
 * backoff continuar de onde parou depois de um restart.
 */
export interface TarefaReivindicada extends TarefaProcessamento {
  tentativas: number;
}

export interface EstadoFila {
  /** Tarefas aguardando um consumidor (inclui lease expirada — ninguém trabalha nelas). */
  pendentes: number;
  /** Tarefas sendo processadas agora (≤ concorrência, por instância). */
  emCurso: number;
  /** Tentativas esgotadas, à espera do reprocessamento retroativo (C2.5). Só na fila durável. */
  esgotadas?: number;
}

/**
 * A fila como a OPERAÇÃO a enxerga: profundidade (sonda de `/saude`, C10.4) e
 * ciclo de vida do consumidor. `iniciar`/`parar` são opcionais porque só a fila
 * durável tem laço de poll para ligar e desligar.
 */
export interface FilaOperavel extends FilaProcessamento {
  estado(): EstadoFila | Promise<EstadoFila>;
  iniciar?(): void;
  parar?(): void;
}

/** Motivo do backoff/esgotamento, já sanitizado antes de ser persistido. */
export interface FalhaTarefa {
  /** Espera antes de a tarefa voltar a ser reivindicável. */
  esperaMs: number;
  /** Teto de tentativas: o armazém decide se esta falha esgotou a tarefa. */
  tentativasMax: number;
  /** Mensagem sanitizada (`sanitizarErro`) — nunca conteúdo de QR/nota (docs/04). */
  erro?: string;
}

/**
 * Armazenamento durável da fila — a porta mínima que `FilaPostgres` precisa.
 *
 * Existe separada da fila para a política de retry/concorrência ser testável sem
 * Postgres: os testes injetam um armazém em memória com a MESMA semântica de
 * lease, e o adaptador real (`ArmazenamentoFilaSupabase`) fica sendo só a
 * tradução para as RPCs.
 */
export interface ArmazenamentoFila {
  enfileirar(tarefa: TarefaProcessamento): Promise<void>;
  /** Reivindica até `limite` tarefas para ESTE consumidor (exclusivo). */
  reivindicar(limite: number): Promise<TarefaReivindicada[]>;
  concluir(cupomId: string): Promise<void>;
  /** Devolve a tarefa à fila com backoff. `true` quando as tentativas esgotaram. */
  falhar(cupomId: string, falha: FalhaTarefa): Promise<boolean>;
  estado(): Promise<EstadoFila>;
}
