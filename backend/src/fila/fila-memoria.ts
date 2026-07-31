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
 * QUANDO USAR ESTA E NÃO A DURÁVEL. Esta serve a UMA instância: é a fila dos
 * testes e do desenvolvimento local (não exige a migração aplicada). Em produção
 * a fila é a `FilaPostgres` (`FILA_DURAVEL`), porque com duas instâncias cada
 * processo teria a SUA lista e as duas processariam os mesmos cupons. Aqui mora
 * a lógica de retry/backoff em memória, com `dormir` injetável para testes
 * determinísticos.
 */

import { logDeCupom } from '../observabilidade/log';
import { sanitizarErro } from '../observabilidade/sanitizar';
import type { EstadoFila, FilaOperavel, TarefaProcessamento } from './tipos';

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

export class FilaMemoria implements FilaOperavel {
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

  /**
   * Profundidade da fila agora — fonte da sonda de saúde (C10.4). Sendo
   * in-process, este número é a única evidência de represamento: um cupom
   * esperando aqui está parado em "Processando" na tela do usuário sem gerar
   * uma única linha de log.
   */
  estado(): EstadoFila {
    return { pendentes: this.pendentes.length, emCurso: this.emCurso.size };
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
    const registro = logDeCupom(tarefa.cupomId, tarefa.uf);
    for (let tentativa = 1; tentativa <= this.tentativasMax; tentativa++) {
      try {
        await this.worker(tarefa);
        // Só vale contar a recuperação: o caminho feliz de primeira é o normal e
        // não precisa de linha de log (seria uma por cupom, sem informação).
        if (tentativa > 1) {
          registro.info(
            { action: 'fila.recuperado', tentativa },
            'Tarefa concluiu após retentativa',
          );
        }
        return;
      } catch (erro) {
        if (tentativa >= this.tentativasMax) {
          this.aoEsgotar?.(tarefa, erro);
          return;
        }
        const espera = Math.min(this.baseBackoffMs * 2 ** (tentativa - 1), this.maxBackoffMs);
        // ACHADO (a): sem esta linha, um portal da SEFAZ oscilando e falhando 4
        // de 5 tentativas parecia PERFEITAMENTE saudável — a degradação só
        // aparecia quando virava falha total. `warn` porque há recuperação
        // automática; a razão de `fila.retentativa`/`fila.recuperado` é o sinal
        // precoce de que um portal está indo embora.
        registro.warn(
          {
            action: 'fila.retentativa',
            tentativa,
            de: this.tentativasMax,
            esperaMs: espera,
            erro: sanitizarErro(erro),
          },
          'Tarefa falhou — repetindo com backoff',
        );
        await this.dormir(espera);
      }
    }
  }
}
