/**
 * C2.1 — O adaptador Postgres da fila é tradução, e é aí que mora o erro chato:
 * nome de RPC, nome de argumento e forma da linha de volta. Um `p_` errado só
 * aparece em produção, como fila que nunca anda.
 */

import { describe, expect, it } from 'vitest';

import { ArmazenamentoFilaSupabase, type ClienteRpcFila } from './armazenamento-supabase';

type Resposta = { data: unknown; error: { message: string; code?: string } | null };

function cliente(resposta: Resposta = { data: null, error: null }): {
  db: ClienteRpcFila;
  chamadas: [string, Record<string, unknown>][];
} {
  const chamadas: [string, Record<string, unknown>][] = [];
  const db: ClienteRpcFila = {
    rpc: (fn, args) => {
      chamadas.push([fn, args]);
      return Promise.resolve(resposta);
    },
  };
  return { db, chamadas };
}

describe('ArmazenamentoFilaSupabase (C2.1)', () => {
  it('enfileira pela RPC, com a UF e o prazo da lease', async () => {
    const { db, chamadas } = cliente();
    const armazem = new ArmazenamentoFilaSupabase(db, { leaseSeg: 120, worker: 'teste:1' });

    await armazem.enfileirar({ cupomId: 'c1', uf: 'RJ' });

    expect(chamadas).toEqual([
      ['fila_enfileirar', { p_cupom_id: 'c1', p_uf: 'RJ', p_lease_seg: 120 }],
    ]);
  });

  it('cupom sem UF conhecida enfileira com null (não string vazia)', async () => {
    const { db, chamadas } = cliente();
    const armazem = new ArmazenamentoFilaSupabase(db, { worker: 'teste:1' });

    await armazem.enfileirar({ cupomId: 'c1' });

    expect(chamadas[0]?.[1]).toMatchObject({ p_uf: null });
  });

  it('reivindica e traduz a linha do banco (char(2) vem com espaço)', async () => {
    const { db, chamadas } = cliente({
      data: [
        { cupom_id: 'c1', uf: 'RJ', tentativas: 1 },
        { cupom_id: 'c2', uf: null, tentativas: 3 },
      ],
      error: null,
    });
    const armazem = new ArmazenamentoFilaSupabase(db, { leaseSeg: 60, worker: 'maquina:42' });

    await expect(armazem.reivindicar(2)).resolves.toEqual([
      { cupomId: 'c1', uf: 'RJ', tentativas: 1 },
      { cupomId: 'c2', tentativas: 3 },
    ]);
    expect(chamadas).toEqual([
      ['fila_reivindicar', { p_limite: 2, p_lease_seg: 60, p_worker: 'maquina:42' }],
    ]);
  });

  it('fila vazia devolve lista vazia, não erro', async () => {
    const { db } = cliente({ data: [], error: null });
    const armazem = new ArmazenamentoFilaSupabase(db);

    await expect(armazem.reivindicar(4)).resolves.toEqual([]);
  });

  it('devolve à fila com o backoff arredondado e diz se esgotou', async () => {
    const { db, chamadas } = cliente({ data: true, error: null });
    const armazem = new ArmazenamentoFilaSupabase(db, { worker: 'teste:1' });

    await expect(
      armazem.falhar('c1', { esperaMs: 1500.6, tentativasMax: 5, erro: 'portal fora do ar' }),
    ).resolves.toBe(true);
    expect(chamadas).toEqual([
      [
        'fila_falhar',
        {
          p_cupom_id: 'c1',
          p_espera_ms: 1501,
          p_tentativas_max: 5,
          p_erro: 'portal fora do ar',
        },
      ],
    ]);
  });

  it('falha sem esgotar devolve false', async () => {
    const { db } = cliente({ data: false, error: null });
    const armazem = new ArmazenamentoFilaSupabase(db);

    await expect(armazem.falhar('c1', { esperaMs: 500, tentativasMax: 5 })).resolves.toBe(false);
  });

  it('estado lê a única linha do `returns table`', async () => {
    const { db } = cliente({
      data: [{ pendentes: 7, em_curso: 2, esgotadas: 1 }],
      error: null,
    });
    const armazem = new ArmazenamentoFilaSupabase(db);

    await expect(armazem.estado()).resolves.toEqual({ pendentes: 7, emCurso: 2, esgotadas: 1 });
  });

  it('estado de fila recém-criada (sem linha) é zero', async () => {
    const { db } = cliente({ data: [], error: null });
    const armazem = new ArmazenamentoFilaSupabase(db);

    await expect(armazem.estado()).resolves.toEqual({ pendentes: 0, emCurso: 0, esgotadas: 0 });
  });

  it('erro do banco vira exceção com o código — migração ausente tem de doer', async () => {
    const { db } = cliente({
      data: null,
      error: { message: 'Could not find the function public.fila_enfileirar', code: 'PGRST202' },
    });
    const armazem = new ArmazenamentoFilaSupabase(db);

    await expect(armazem.enfileirar({ cupomId: 'c1' })).rejects.toThrow(/PGRST202/);
  });
});
