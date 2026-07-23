import { describe, expect, it, vi } from 'vitest';

import { FilaMemoria } from './fila-memoria';

const semEspera = (): Promise<void> => Promise.resolve();

describe('FilaMemoria (C2.1)', () => {
  it('processa uma tarefa enfileirada', async () => {
    const worker = vi.fn().mockResolvedValue(undefined);
    const fila = new FilaMemoria(worker, { dormir: semEspera });

    await fila.enfileirar({ cupomId: 'c1' });
    await fila.ociosa();

    expect(worker).toHaveBeenCalledWith({ cupomId: 'c1' });
    expect(worker).toHaveBeenCalledTimes(1);
  });

  it('dá retry com backoff em erro transitório até suceder', async () => {
    const worker = vi
      .fn()
      .mockRejectedValueOnce(new Error('portal fora do ar'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(undefined);
    const dormir = vi.fn(semEspera);
    const fila = new FilaMemoria(worker, { dormir, baseBackoffMs: 100 });

    await fila.enfileirar({ cupomId: 'c1' });
    await fila.ociosa();

    expect(worker).toHaveBeenCalledTimes(3);
    // Backoff exponencial: 100ms, depois 200ms.
    expect(dormir).toHaveBeenNthCalledWith(1, 100);
    expect(dormir).toHaveBeenNthCalledWith(2, 200);
  });

  it('desiste após tentativasMax e avisa aoEsgotar', async () => {
    const worker = vi.fn().mockRejectedValue(new Error('sempre falha'));
    const aoEsgotar = vi.fn();
    const fila = new FilaMemoria(worker, { tentativasMax: 3, dormir: semEspera, aoEsgotar });

    await fila.enfileirar({ cupomId: 'c1' });
    await fila.ociosa();

    expect(worker).toHaveBeenCalledTimes(3);
    expect(aoEsgotar).toHaveBeenCalledOnce();
  });

  it('processa tarefa enfileirada durante o processamento (não trava)', async () => {
    const vistos: string[] = [];
    const fila = new FilaMemoria(
      (t: { cupomId: string }) => {
        vistos.push(t.cupomId);
        if (t.cupomId === 'a') void fila.enfileirar({ cupomId: 'b' });
        return Promise.resolve();
      },
      { dormir: semEspera },
    );

    await fila.enfileirar({ cupomId: 'a' });
    await fila.ociosa();

    expect(vistos).toEqual(['a', 'b']);
  });

  it('processa várias tarefas em ordem (FIFO)', async () => {
    const vistos: string[] = [];
    const worker = vi.fn((t: { cupomId: string }) => {
      vistos.push(t.cupomId);
      return Promise.resolve();
    });
    // Concorrência 1 = a ordem de INÍCIO é também a de conclusão.
    const fila = new FilaMemoria(worker, { dormir: semEspera, concorrencia: 1 });

    await fila.enfileirar({ cupomId: 'a' });
    await fila.enfileirar({ cupomId: 'b' });
    await fila.enfileirar({ cupomId: 'c' });
    await fila.ociosa();

    expect(vistos).toEqual(['a', 'b', 'c']);
  });

  it('processa em PARALELO até o teto de concorrência', async () => {
    // O trabalho é espera de rede (portal da SEFAZ). Drenando de um em um, o
    // processo ficava ocioso e a vazão era ~1 cupom por resposta do portal.
    let emVoo = 0;
    let picoEmVoo = 0;
    let abrirPortao!: () => void;
    const portao = new Promise<void>((r) => {
      abrirPortao = r;
    });
    const fila = new FilaMemoria(
      async () => {
        emVoo++;
        picoEmVoo = Math.max(picoEmVoo, emVoo);
        await portao;
        emVoo--;
      },
      { dormir: semEspera, concorrencia: 3 },
    );

    for (const cupomId of ['a', 'b', 'c', 'd', 'e']) {
      await fila.enfileirar({ cupomId });
    }
    // Os 3 consumidores já pegaram tarefa e estão presos no portão.
    expect(picoEmVoo).toBe(3);

    abrirPortao();
    await fila.ociosa();
    expect(emVoo).toBe(0);
  });

  it('nenhuma tarefa é processada duas vezes com concorrência', async () => {
    const vistos: string[] = [];
    const fila = new FilaMemoria(
      async (t: { cupomId: string }) => {
        await Promise.resolve();
        vistos.push(t.cupomId);
      },
      { dormir: semEspera, concorrencia: 4 },
    );

    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
    for (const cupomId of ids) await fila.enfileirar({ cupomId });
    await fila.ociosa();

    expect(vistos).toHaveLength(20);
    expect(new Set(vistos).size).toBe(20);
  });
});
