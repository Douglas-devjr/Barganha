/**
 * Porta da fila de processamento (C2.1). A ingestão só depende de `enfileirar`;
 * quem processa (worker) e a durabilidade são detalhes do adaptador.
 */

export interface TarefaProcessamento {
  cupomId: string;
}

export interface FilaProcessamento {
  enfileirar(tarefa: TarefaProcessamento): Promise<void>;
}
