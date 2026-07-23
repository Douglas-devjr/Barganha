/**
 * Fila de processamento assíncrona em memória, com retry e backoff exponencial
 * (C2.1 — robustez do docs/03). Isola o pico/instabilidade dos portais SEFAZ
 * do request de ingestão: o app não espera o parsing.
 *
 * Política: só dá retry quando o worker LANÇA (erro transitório, ex.: portal
 * fora do ar). Erros permanentes o próprio processador trata (marca `falha`) e
 * retorna sem lançar — a fila não tenta de novo. Esgotadas as tentativas, o
 * cupom fica como está (tipicamente `qr_capturado`) e o reprocessamento
 * retroativo (C2.5) pode pegá-lo mais tarde.
 *
 * Em produção a durabilidade da fila é definida na infra (C10); aqui mora a
 * lógica de retry/backoff, com `dormir` injetável para testes determinísticos.
 */

import type { FilaProcessamento, TarefaProcessamento } from './tipos';

export interface OpcoesFila {
  /** Máximo de tentativas por tarefa (inclui a primeira). */
  tentativasMax?: number;
  /** Backoff base em ms (cresce ~2^n). */
  baseBackoffMs?: number;
  /** Teto do backoff em ms. */
  maxBackoffMs?: number;
  /** Espera injetável (testes passam um no-op). */
  dormir?: (ms: number) => Promise<void>;
  /** Telemetria: chamada quando a tarefa falha em todas as tentativas. */
  aoEsgotar?: (tarefa: TarefaProcessamento, erro: unknown) => void;
  /**
   * Tarefas processadas em paralelo. O trabalho é dominado por ESPERA de rede
   * (consulta ao portal da SEFAZ), então drenar uma a uma deixava o processo
   * ocioso a maior parte do tempo e limitava a vazão a ~1 cupom por resposta do
   * portal. Moderado de propósito: é o portal do estado do outro lado, não o
   * nosso banco — não é para martelá-lo (docs/03).
   */
  concorrencia?: number;
}

type Worker = (tarefa: TarefaProcessamento) => Promise<void>;

const dormirReal = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Tarefas em paralelo por padrão — ver `OpcoesFila.concorrencia`. */
export const CONCORRENCIA_PADRAO = 4;

export class FilaMemoria implements FilaProcessamento {
  private readonly tentativasMax: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly dormir: (ms: number) => Promise<void>;
  private readonly aoEsgotar?: (tarefa: TarefaProcessamento, erro: unknown) => void;
  private readonly concorrencia: number;

  private readonly pendentes: TarefaProcessamento[] = [];
  /** Consumidores vivos agora (≤ `concorrencia`). */
  private readonly emCurso = new Set<Promise<void>>();

  constructor(
    private readonly worker: Worker,
    opcoes: OpcoesFila = {},
  ) {
    this.tentativasMax = opcoes.tentativasMax ?? 5;
    this.baseBackoffMs = opcoes.baseBackoffMs ?? 500;
    this.maxBackoffMs = opcoes.maxBackoffMs ?? 30_000;
    this.dormir = opcoes.dormir ?? dormirReal;
    this.aoEsgotar = opcoes.aoEsgotar;
    this.concorrencia = Math.max(1, opcoes.concorrencia ?? CONCORRENCIA_PADRAO);
  }

  enfileirar(tarefa: TarefaProcessamento): Promise<void> {
    this.pendentes.push(tarefa);
    this.bombear();
    return Promise.resolve();
  }

  /** Resolve quando a fila esvazia e nada está em processamento (testes). */
  async ociosa(): Promise<void> {
    // Laço: uma tarefa enfileirada enquanto os consumidores terminavam precisa
    // reativar a bomba antes de darmos a fila por ociosa.
    while (this.emCurso.size > 0 || this.pendentes.length > 0) {
      await Promise.all([...this.emCurso]);
      this.bombear();
    }
  }

  /**
   * Garante consumidores suficientes para o que está pendente, até o teto de
   * `concorrencia`. Chamado a cada `enfileirar`: sem isso, os consumidores
   * criados junto com a primeira tarefa achariam a lista vazia, morreriam, e o
   * resto da leva seria drenado por um único sobrevivente — de volta ao serial.
   */
  private bombear(): void {
    while (this.emCurso.size < this.concorrencia && this.pendentes.length > 0) {
      const consumidor: Promise<void> = this.consumir().finally(() => {
        this.emCurso.delete(consumidor);
      });
      this.emCurso.add(consumidor);
    }
  }

  /**
   * Um consumidor: puxa da lista compartilhada até secar. Como `shift` é
   * síncrono e não há `await` entre testar e retirar, dois consumidores nunca
   * pegam a mesma tarefa.
   */
  private async consumir(): Promise<void> {
    let tarefa = this.pendentes.shift();
    while (tarefa) {
      await this.executarComRetry(tarefa);
      tarefa = this.pendentes.shift();
    }
  }

  private async executarComRetry(tarefa: TarefaProcessamento): Promise<void> {
    for (let tentativa = 1; tentativa <= this.tentativasMax; tentativa++) {
      try {
        await this.worker(tarefa);
        return;
      } catch (erro) {
        if (tentativa >= this.tentativasMax) {
          this.aoEsgotar?.(tarefa, erro);
          return;
        }
        const espera = Math.min(this.baseBackoffMs * 2 ** (tentativa - 1), this.maxBackoffMs);
        await this.dormir(espera);
      }
    }
  }
}
