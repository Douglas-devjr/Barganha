/**
 * C3.4 — O ranking durável das abreviações que faltam no mapa de unidades.
 * É a leitura que faltava para o contador de `unidade_recusada:` servir para
 * alguma coisa: em memória ele zera toda vez que a instância dorme.
 */

import { describe, expect, it } from 'vitest';

import { RankingUnidadesRecusadas, type ClienteRpcUnidadesRecusadas } from './unidades-recusadas';

function clienteQueDevolve(data: unknown): {
  db: ClienteRpcUnidadesRecusadas;
  chamadas: unknown[][];
} {
  const chamadas: unknown[][] = [];
  const db: ClienteRpcUnidadesRecusadas = {
    rpc: (fn, args) => {
      chamadas.push([fn, args]);
      return Promise.resolve({ data, error: null });
    },
  };
  return { db, chamadas };
}

describe('RankingUnidadesRecusadas (C3.4)', () => {
  it('lê o acumulado do Postgres com a janela padrão de 30 dias', async () => {
    const { db, chamadas } = clienteQueDevolve([
      { unidade: 'BDJ', total: 42, ufs: ['RJ', 'SP'] },
      { unidade: 'XPTO', total: 3, ufs: ['MG'] },
    ]);

    const ranking = await new RankingUnidadesRecusadas(db).ranking();

    expect(ranking).toEqual([
      { unidade: 'BDJ', total: 42, ufs: ['RJ', 'SP'] },
      { unidade: 'XPTO', total: 3, ufs: ['MG'] },
    ]);
    expect(chamadas).toEqual([['unidades_recusadas_recentes', { p_dias: 30 }]]);
  });

  it('aceita a janela pedida pelo curador', async () => {
    const { db, chamadas } = clienteQueDevolve([]);
    await new RankingUnidadesRecusadas(db).ranking(7);
    expect(chamadas).toEqual([['unidades_recusadas_recentes', { p_dias: 7 }]]);
  });

  it('coage o bigint que volta como string (varia com o driver)', async () => {
    const { db } = clienteQueDevolve([{ unidade: 'CX', total: '17', ufs: ['RJ'] }]);
    expect(await new RankingUnidadesRecusadas(db).ranking()).toEqual([
      { unidade: 'CX', total: 17, ufs: ['RJ'] },
    ]);
  });

  it('descarta linha sem unidade em vez de propagar lixo para o painel', async () => {
    const { db } = clienteQueDevolve([{ unidade: '', total: 5 }, null, { total: 9 }]);
    expect(await new RankingUnidadesRecusadas(db).ranking()).toEqual([]);
  });

  it('erro do banco LANÇA — quem chama decide se some com o bloco ou não', async () => {
    // O oposto de devolver `[]`: lista vazia diria "nenhuma unidade recusada",
    // que é o diagnóstico contrário de "não consegui perguntar".
    const db: ClienteRpcUnidadesRecusadas = {
      rpc: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }),
    };
    await expect(new RankingUnidadesRecusadas(db).ranking()).rejects.toThrow('permission denied');
  });
});
