/**
 * Fila de processamento DURÁVEL (C2.1) — mesmo contrato da `FilaMemoria`, mas o
 * estado mora no Postgres (`fila_processamento`, migração 20260729100000).
 *
 * POR QUE ELA EXISTE. A fila em memória é correta com UMA instância. Com duas,
 * cada processo tem a sua lista e as duas processam os mesmos cupons — dois
 * parses e duas idas ao portal da SEFAZ pelo mesmo cupom. Aqui a exclusão mútua
 * é do banco: `fila_reivindicar` usa `for update skip locked`, então cada tarefa
 * é entregue a UM consumidor, quantas instâncias existirem.
 *
 * O QUE MUDA EM RELAÇÃO À FILA EM MEMÓRIA:
 *  • o backoff não é `await dormir(...)` dentro do processo — é `disponivel_em`
 *    no futuro. Um restart no meio do backoff não perde a tarefa;
 *  • a contagem de tentativas é do banco e sobrevive ao restart;
 *  • a tentativa é contada no ATO DE PEGAR (não no fim), então worker que travou
 *    e perdeu a lease consome uma tentativa: cupom-veneno esgota em vez de
 *    circular para sempre entre as instâncias.
 *
 * A política permanece a mesma: só há retry quando o worker LANÇA (erro
 * transitório, ex.: portal fora do ar). Erro permanente o processador trata
 * (marca `falha`) e retorna sem lançar — a tarefa é concluída e sai da fila.
 * Esgotadas as tentativas, o cupom fica como está e o reprocessamento
 * retroativo (C2.5) pode rearmá-lo.
 *
 * COMO UMA TAREFA CHEGA AQUI. Dois caminhos, de propósito:
 *  1. `enfileirar` bombeia na hora — a latência do caminho felizmente segue a
 *     mesma de antes (o app não espera o parsing, mas também não espera o poll);
 *  2. o poll (`iniciar`) é a rede: pega o que OUTRA instância enfileirou, o que
 *     está saindo do backoff e o que ficou órfão com a lease expirada.
 */

import { log, logDeCupom } from '../observabilidade/log';
import { sanitizarErro } from '../observabilidade/sanitizar';
import type {
  ArmazenamentoFila,
  EstadoFila,
  FilaOperavel,
  TarefaProcessamento,
  TarefaReivindicada,
} from './tipos';

export interface OpcoesFilaPostgres {
  /** Máximo de tentativas por tarefa (inclui a primeira). */
  tentativasMax?: number;
  /** Backoff base em ms (cresce ~2^n). */
  baseBackoffMs?: number;
  /** Teto do backoff em ms. */
  maxBackoffMs?: number;
  /** Tarefas processadas em paralelo por INSTÂNCIA (ver `fila-memoria.ts`). */
  concorrencia?: number;
  /**
   * Intervalo do poll. É o atraso máximo para esta instância notar trabalho que
   * não passou pelo seu próprio `enfileirar` — moderado de propósito: cada poll
   * é uma consulta ao Postgres, e no free tier isso roda o dia todo.
   */
  intervaloPollMs?: number;
  /** Telemetria: chamada quando a tarefa falha em todas as tentativas. */
  aoEsgotar?: (tarefa: TarefaProcessamento, erro: unknown) => void;
}

type Worker = (tarefa: TarefaProcessamento) => Promise<void>;

/** Tarefas em paralelo por instância — igual à fila em memória. */
export const CONCORRENCIA_PADRAO = 4;
/** Poll padrão: 5s. Ver `OpcoesFilaPostgres.intervaloPollMs`. */
export const POLL_PADRAO_MS = 5_000;

export class FilaPostgres implements FilaOperavel {
  private readonly tentativasMax: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly concorrencia: number;
  private readonly intervaloPollMs: number;
  private readonly aoEsgotar?: (tarefa: TarefaProcessamento, erro: unknown) => void;

  /** Execuções vivas nesta instância (≤ `concorrencia`). */
  private readonly emCurso = new Set<Promise<void>>();
  /** Despertadores do backoff — guardados para `parar` não deixar timer solto. */
  private readonly despertadores = new Set<NodeJS.Timeout>();
  private poll?: NodeJS.Timeout;

  /**
   * Uma bomba por vez: reivindicar é uma ida ao banco, e duas bombas
   * concorrentes pediriam vagas contando o mesmo `emCurso` desatualizado. Quem
   * chega no meio marca `bombearDeNovo` em vez de esperar.
   */
  private bombeando = false;
  private bombearDeNovo = false;

  constructor(
    private readonly armazem: ArmazenamentoFila,
    private readonly worker: Worker,
    opcoes: OpcoesFilaPostgres = {},
  ) {
    this.tentativasMax = Math.max(1, opcoes.tentativasMax ?? 5);
    this.baseBackoffMs = opcoes.baseBackoffMs ?? 500;
    this.maxBackoffMs = opcoes.maxBackoffMs ?? 30_000;
    this.concorrencia = Math.max(1, opcoes.concorrencia ?? CONCORRENCIA_PADRAO);
    this.intervaloPollMs = Math.max(250, opcoes.intervaloPollMs ?? POLL_PADRAO_MS);
    this.aoEsgotar = opcoes.aoEsgotar;
  }

  /**
   * Grava a tarefa e tenta drenar já. A gravação é AGUARDADA: se o banco não
   * aceitou, quem ingeriu precisa saber — engolir o erro deixaria o cupom em
   * "Processando" na tela sem ninguém para pegá-lo.
   */
  async enfileirar(tarefa: TarefaProcessamento): Promise<void> {
    await this.armazem.enfileirar(tarefa);
    void this.bombear();
  }

  /** Liga o poll (ver o cabeçalho: é o que traz trabalho de outra instância). */
  iniciar(): void {
    if (this.poll) return;
    this.poll = setInterval(() => void this.bombear(), this.intervaloPollMs);
    // Não segurar o processo de pé só por causa do timer (encerramento, testes).
    this.poll.unref?.();
    void this.bombear();
  }

  /**
   * Desliga o poll e os despertadores. NÃO devolve as tarefas em curso: elas
   * saem da lease por vencimento e outra instância (ou a próxima subida) as
   * retoma — é o mesmo caminho de uma instância morta sem aviso.
   */
  parar(): void {
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = undefined;
    }
    for (const timer of this.despertadores) clearTimeout(timer);
    this.despertadores.clear();
  }

  /** Profundidade da fila (compartilhada) — fonte da sonda de saúde (C10.4). */
  estado(): Promise<EstadoFila> {
    return this.armazem.estado();
  }

  /**
   * Drena o que está reivindicável AGORA e volta quando esta instância não tem
   * mais nada em curso. Usada pelos testes e disponível para um drenador
   * pontual; não é o caminho normal (esse é `enfileirar` + poll).
   *
   * Não espera pelo que está em backoff no futuro nem pelo que outra instância
   * reivindicou — esperar por lease de terceiro travaria para sempre.
   */
  async drenar(): Promise<void> {
    for (;;) {
      await this.bombear();
      if (this.emCurso.size === 0) return;
      await Promise.all([...this.emCurso]);
    }
  }

  private async bombear(): Promise<void> {
    if (this.bombeando) {
      this.bombearDeNovo = true;
      return;
    }
    this.bombeando = true;
    try {
      do {
        this.bombearDeNovo = false;
        await this.reivindicarLote();
      } while (this.bombearDeNovo);
    } finally {
      this.bombeando = false;
    }
  }

  /** Enche as vagas livres desta instância, até o banco não ter mais o que dar. */
  private async reivindicarLote(): Promise<void> {
    while (this.emCurso.size < this.concorrencia) {
      const vagas = this.concorrencia - this.emCurso.size;
      let tarefas: TarefaReivindicada[];
      try {
        tarefas = await this.armazem.reivindicar(vagas);
      } catch (erro) {
        // Banco fora: não há como saber o que processar. O poll seguinte tenta de
        // novo e a sonda de `/saude` acusa a fila cega — nada é perdido, porque
        // nada foi reivindicado.
        log.error(
          { action: 'fila.reivindicacao_falhou', erro: sanitizarErro(erro) },
          'Falha ao reivindicar tarefas da fila durável',
        );
        return;
      }
      if (tarefas.length === 0) return;
      for (const tarefa of tarefas) this.acompanhar(tarefa);
    }
  }

  /** Executa a tarefa e, ao terminar, libera a vaga e vai buscar mais trabalho. */
  private acompanhar(tarefa: TarefaReivindicada): void {
    const execucao: Promise<void> = this.executar(tarefa).finally(() => {
      this.emCurso.delete(execucao);
      // Sem isto, uma instância que encheu as 4 vagas só voltaria a puxar
      // trabalho no próximo poll, mesmo com a fila cheia.
      void this.bombear();
    });
    this.emCurso.add(execucao);
  }

  private async executar(tarefa: TarefaReivindicada): Promise<void> {
    const registro = logDeCupom(tarefa.cupomId, tarefa.uf);
    try {
      await this.worker(tarefa);
      // Só vale contar a recuperação: o caminho feliz de primeira é o normal e
      // não precisa de linha de log (seria uma por cupom, sem informação).
      if (tarefa.tentativas > 1) {
        registro.info(
          { action: 'fila.recuperado', tentativa: tarefa.tentativas },
          'Tarefa concluiu após retentativa',
        );
      }
      // Falhar AQUI (worker ok, `concluir` não) devolve a tarefa à fila e o cupom
      // é reprocessado — inofensivo: o processador sai na hora se já está
      // `processado` e o pool deduplica por chave publicada.
      await this.armazem.concluir(tarefa.cupomId);
    } catch (erro) {
      await this.tratarFalha(tarefa, erro, registro);
    }
  }

  private async tratarFalha(
    tarefa: TarefaReivindicada,
    erro: unknown,
    registro: ReturnType<typeof logDeCupom>,
  ): Promise<void> {
    const espera = Math.min(
      this.baseBackoffMs * 2 ** Math.max(tarefa.tentativas - 1, 0),
      this.maxBackoffMs,
    );
    const { mensagem } = sanitizarErro(erro);

    let esgotada: boolean;
    try {
      esgotada = await this.armazem.falhar(tarefa.cupomId, {
        esperaMs: espera,
        tentativasMax: this.tentativasMax,
        erro: mensagem,
      });
    } catch (erroBanco) {
      // Nem a falha conseguimos registrar. A lease vence e a tarefa volta
      // sozinha — mas isso é uma retentativa que ninguém contou, então precisa
      // aparecer no log.
      registro.error(
        { action: 'fila.falha_nao_registrada', erro: sanitizarErro(erroBanco) },
        'Falha ao devolver a tarefa à fila — será retomada quando a lease vencer',
      );
      return;
    }

    if (esgotada) {
      this.aoEsgotar?.(tarefa, erro);
      return;
    }
    // Sem esta linha, um portal da SEFAZ oscilando e falhando 4 de 5 tentativas
    // parece PERFEITAMENTE saudável — a degradação só apareceria quando virasse
    // falha total. `warn` porque há recuperação automática.
    registro.warn(
      {
        action: 'fila.retentativa',
        tentativa: tarefa.tentativas,
        de: this.tentativasMax,
        esperaMs: espera,
        erro: mensagem,
      },
      'Tarefa falhou — repetindo com backoff',
    );
    this.despertarEm(espera);
  }

  /**
   * Acorda a bomba quando o backoff desta tarefa vencer. É otimização de
   * latência, não correção: se o processo morrer antes, o poll de qualquer
   * instância pega a tarefa quando `disponivel_em` chegar.
   */
  private despertarEm(ms: number): void {
    const timer = setTimeout(() => {
      this.despertadores.delete(timer);
      void this.bombear();
    }, ms);
    timer.unref?.();
    this.despertadores.add(timer);
  }
}
