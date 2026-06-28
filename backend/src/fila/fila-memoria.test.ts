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
    const fila = new FilaMemoria(worker, { dormir: semEspera });

    await fila.enfileirar({ cupomId: 'a' });
    await fila.enfileirar({ cupomId: 'b' });
    await fila.enfileirar({ cupomId: 'c' });
    await fila.ociosa();

    expect(vistos).toEqual(['a', 'b', 'c']);
  });
});
