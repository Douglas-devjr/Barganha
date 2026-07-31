/**
 * C2.1 — A fila durável. O teste que justifica o arquivo existir é
 * "duas instâncias não processam o mesmo cupom": é exatamente o que a fila em
 * memória não consegue dar, e o motivo de a etapa ficar em `parcial`.
 *
 * O armazém aqui é um fake COM a mesma semântica de lease do Postgres
 * (`disponivel_em`, `reivindicado_em`, `tentativas`, `esgotado_em`). O que a
 * migração garante e o fake reproduz é a exclusividade da reivindicação — no
 * banco isso é `for update skip locked`; aqui, marcar a lease no mesmo tique
 * síncrono da seleção.
 */

import { describe, expect, it, vi } from 'vitest';

import { FilaPostgres } from './fila-postgres';
import type {
  ArmazenamentoFila,
  EstadoFila,
  FalhaTarefa,
  TarefaProcessamento,
  TarefaReivindicada,
} from './tipos';

interface Linha {
  cupomId: string;
  uf?: string;
  tentativas: number;
  disponivelEm: number;
  reivindicadoEm?: number;
  esgotadoEm?: number;
}

class ArmazemFake implements ArmazenamentoFila {
  readonly linhas = new Map<string, Linha>();
  /** Relógio injetável: é como se testa lease vencida sem esperar de verdade. */
  agora = 0;

  constructor(private readonly leaseMs = 300_000) {}

  enfileirar(tarefa: TarefaProcessamento): Promise<void> {
    const atual = this.linhas.get(tarefa.cupomId);
    // Tarefa com lease VIVA não é rearmada (o `where` do DO UPDATE na migração).
    if (atual && this.comLeaseViva(atual)) return Promise.resolve();
    const uf = tarefa.uf ?? atual?.uf;
    this.linhas.set(tarefa.cupomId, {
      cupomId: tarefa.cupomId,
      ...(uf ? { uf } : {}),
      tentativas: 0,
      disponivelEm: this.agora,
    });
    return Promise.resolve();
  }

  reivindicar(limite: number): Promise<TarefaReivindicada[]> {
    const elegiveis = [...this.linhas.values()]
      .filter(
        (l) => l.esgotadoEm === undefined && l.disponivelEm <= this.agora && !this.comLeaseViva(l),
      )
      .sort((a, b) => a.disponivelEm - b.disponivelEm)
      .slice(0, Math.max(limite, 0));
    return Promise.resolve(
      elegiveis.map((l) => {
        l.reivindicadoEm = this.agora;
        l.tentativas += 1;
        return { cupomId: l.cupomId, ...(l.uf ? { uf: l.uf } : {}), tentativas: l.tentativas };
      }),
    );
  }

  concluir(cupomId: string): Promise<void> {
    this.linhas.delete(cupomId);
    return Promise.resolve();
  }

  falhar(cupomId: string, falha: FalhaTarefa): Promise<boolean> {
    const linha = this.linhas.get(cupomId);
    if (!linha) return Promise.resolve(false);
    linha.reivindicadoEm = undefined;
    linha.disponivelEm = this.agora + falha.esperaMs;
    if (linha.tentativas >= falha.tentativasMax) {
      linha.esgotadoEm = this.agora;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  estado(): Promise<EstadoFila> {
    const todas = [...this.linhas.values()];
    const vivas = todas.filter((l) => l.esgotadoEm === undefined);
    return Promise.resolve({
      pendentes: vivas.filter((l) => !this.comLeaseViva(l)).length,
      emCurso: vivas.filter((l) => this.comLeaseViva(l)).length,
      esgotadas: todas.filter((l) => l.esgotadoEm !== undefined).length,
    });
  }

  private comLeaseViva(linha: Linha): boolean {
    return linha.reivindicadoEm !== undefined && linha.reivindicadoEm > this.agora - this.leaseMs;
  }
}

/** Backoff zero: o teste não espera relógio — a tarefa volta na volta seguinte. */
const semBackoff = { baseBackoffMs: 0 };

describe('FilaPostgres (C2.1)', () => {
  it('processa a tarefa e só então a remove da fila', async () => {
    const armazem = new ArmazemFake();
    const worker = vi.fn().mockResolvedValue(undefined);
    const fila = new FilaPostgres(armazem, worker, semBackoff);

    await fila.enfileirar({ cupomId: 'c1', uf: 'RJ' });
    await fila.drenar();

    expect(worker).toHaveBeenCalledWith({ cupomId: 'c1', uf: 'RJ', tentativas: 1 });
    expect(armazem.linhas.size).toBe(0);
  });

  it('conta a tentativa no BANCO e repete com backoff até suceder', async () => {
    const armazem = new ArmazemFake();
    const worker = vi
      .fn()
      .mockRejectedValueOnce(new Error('portal fora do ar'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(undefined);
    const fila = new FilaPostgres(armazem, worker, semBackoff);

    await fila.enfileirar({ cupomId: 'c1' });
    await fila.drenar();

    expect(worker).toHaveBeenCalledTimes(3);
    // A 3ª entrega chegou com o contador do BANCO, não da memória do processo.
    expect(worker).toHaveBeenLastCalledWith({ cupomId: 'c1', tentativas: 3 });
    expect(armazem.linhas.size).toBe(0);
  });

  it('o backoff vira `disponivel_em` no futuro, sem segurar o processo', async () => {
    const armazem = new ArmazemFake();
    const worker = vi.fn().mockRejectedValue(new Error('portal caiu'));
    const fila = new FilaPostgres(armazem, worker, { baseBackoffMs: 500 });

    await fila.enfileirar({ cupomId: 'c1' });
    await fila.drenar();
    fila.parar();

    // Uma tentativa só: a próxima não é "esperar aqui", é a linha reaparecer.
    expect(worker).toHaveBeenCalledTimes(1);
    const linha = armazem.linhas.get('c1');
    expect(linha?.tentativas).toBe(1);
    expect(linha?.disponivelEm).toBe(500);
    expect(linha?.reivindicadoEm).toBeUndefined();
  });

  it('esgota após tentativasMax, avisa aoEsgotar e deixa a linha como evidência', async () => {
    const armazem = new ArmazemFake();
    const aoEsgotar = vi.fn();
    const worker = vi.fn().mockRejectedValue(new Error('sempre falha'));
    const fila = new FilaPostgres(armazem, worker, { ...semBackoff, tentativasMax: 3, aoEsgotar });

    await fila.enfileirar({ cupomId: 'c1' });
    await fila.drenar();

    expect(worker).toHaveBeenCalledTimes(3);
    expect(aoEsgotar).toHaveBeenCalledOnce();
    expect(armazem.linhas.get('c1')?.esgotadoEm).toBeDefined();
    // Esgotada sai da fila de trabalho: nenhuma instância a pega de novo.
    await expect(armazem.reivindicar(10)).resolves.toEqual([]);
  });

  it('DUAS instâncias sobre a mesma fila nunca processam o mesmo cupom', async () => {
    const armazem = new ArmazemFake();
    const vistos: string[] = [];
    const worker = async (t: TarefaProcessamento): Promise<void> => {
      // O `await` abre a janela em que a segunda instância pegaria a mesma
      // tarefa se a reivindicação não fosse exclusiva.
      await Promise.resolve();
      vistos.push(t.cupomId);
    };
    const instanciaA = new FilaPostgres(armazem, worker, semBackoff);
    const instanciaB = new FilaPostgres(armazem, worker, semBackoff);

    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
    for (const cupomId of ids) await armazem.enfileirar({ cupomId });
    await Promise.all([instanciaA.drenar(), instanciaB.drenar()]);

    expect(vistos).toHaveLength(20);
    expect(new Set(vistos).size).toBe(20);
    expect(armazem.linhas.size).toBe(0);
  });

  it('o poll pega o que OUTRA instância enfileirou', async () => {
    vi.useFakeTimers();
    try {
      const armazem = new ArmazemFake();
      const worker = vi.fn().mockResolvedValue(undefined);
      const fila = new FilaPostgres(armazem, worker, { ...semBackoff, intervaloPollMs: 1_000 });

      fila.iniciar();
      // Chegou pela outra instância: este processo não viu `enfileirar` nenhum.
      await armazem.enfileirar({ cupomId: 'de-outra-instancia' });
      expect(worker).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_100);

      expect(worker).toHaveBeenCalledWith({ cupomId: 'de-outra-instancia', tentativas: 1 });
      fila.parar();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retoma a tarefa cuja lease venceu (instância que morreu no meio)', async () => {
    const armazem = new ArmazemFake(60_000);
    const worker = vi.fn().mockResolvedValue(undefined);
    const fila = new FilaPostgres(armazem, worker, semBackoff);

    // Instância morta: reivindicou (lease aberta) e nunca concluiu.
    await armazem.enfileirar({ cupomId: 'orfa' });
    await armazem.reivindicar(1);
    await expect(armazem.estado()).resolves.toMatchObject({ pendentes: 0, emCurso: 1 });

    // Ninguém a toca enquanto a lease vale...
    await fila.drenar();
    expect(worker).not.toHaveBeenCalled();

    // ...e ela volta à fila quando vence.
    armazem.agora += 60_001;
    await fila.drenar();
    expect(worker).toHaveBeenCalledWith({ cupomId: 'orfa', tentativas: 2 });
  });

  it('propaga a falha de gravação para quem ingeriu (nada de cupom órfão calado)', async () => {
    const armazem = new ArmazemFake();
    vi.spyOn(armazem, 'enfileirar').mockRejectedValue(new Error('banco fora'));
    const fila = new FilaPostgres(armazem, vi.fn().mockResolvedValue(undefined), semBackoff);

    await expect(fila.enfileirar({ cupomId: 'c1' })).rejects.toThrow('banco fora');
  });

  it('estado() reporta a profundidade COMPARTILHADA da fila', async () => {
    const armazem = new ArmazemFake();
    const fila = new FilaPostgres(armazem, vi.fn().mockResolvedValue(undefined), semBackoff);

    await armazem.enfileirar({ cupomId: 'c1' });
    await armazem.enfileirar({ cupomId: 'c2' });
    await armazem.reivindicar(1);

    await expect(fila.estado()).resolves.toEqual({ pendentes: 1, emCurso: 1, esgotadas: 0 });
  });
});
