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
}

type Worker = (tarefa: TarefaProcessamento) => Promise<void>;

const dormirReal = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class FilaMemoria implements FilaProcessamento {
  private readonly tentativasMax: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly dormir: (ms: number) => Promise<void>;
  private readonly aoEsgotar?: (tarefa: TarefaProcessamento, erro: unknown) => void;

  private readonly pendentes: TarefaProcessamento[] = [];
  private bombeando = false;
  private cicloAtual: Promise<void> = Promise.resolve();

  constructor(
    private readonly worker: Worker,
    opcoes: OpcoesFila = {},
  ) {
    this.tentativasMax = opcoes.tentativasMax ?? 5;
    this.baseBackoffMs = opcoes.baseBackoffMs ?? 500;
    this.maxBackoffMs = opcoes.maxBackoffMs ?? 30_000;
    this.dormir = opcoes.dormir ?? dormirReal;
    this.aoEsgotar = opcoes.aoEsgotar;
  }

  enfileirar(tarefa: TarefaProcessamento): Promise<void> {
    this.pendentes.push(tarefa);
    this.bombear();
    return Promise.resolve();
  }

  /** Resolve quando a fila esvazia e nada está em processamento (testes). */
  async ociosa(): Promise<void> {
    // Laço: uma tarefa enfileirada enquanto o ciclo terminava reativa a bomba.
    while (this.bombeando || this.pendentes.length > 0) {
      await this.cicloAtual;
    }
  }

  private bombear(): void {
    if (this.bombeando) return;
    this.bombeando = true;
    this.cicloAtual = this.drenar().finally(() => {
      this.bombeando = false;
      // Algo chegou na janela entre o último shift e este reset: re-bombeia.
      if (this.pendentes.length > 0) this.bombear();
    });
  }

  private async drenar(): Promise<void> {
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
