import type { PrecoEstatistica } from '@barganha/shared';
import { describe, expect, it } from 'vitest';

import type { LinhaEstatistica } from '../estatistica/tipos';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoSync } from './servico-sync';
import type { FiltroDeltaSync, FonteDeltaSync } from './tipos';

function estat(
  over: Partial<PrecoEstatistica> & Pick<PrecoEstatistica, 'atualizadoEm'>,
): PrecoEstatistica {
  return {
    produtoCanonicoId: 'p-1',
    escopo: 'municipio',
    escopoId: 'RJ:Rio de Janeiro',
    unidadeBase: 'L',
    mediana: 5,
    nObservacoes: 8,
    ...over,
  };
}

/** Stub que captura o filtro recebido e devolve linhas pré-definidas. */
class FonteStub implements FonteDeltaSync {
  filtro?: FiltroDeltaSync;
  constructor(private readonly linhas: PrecoEstatistica[]) {}
  deltaEstatisticas(filtro: FiltroDeltaSync): Promise<PrecoEstatistica[]> {
    this.filtro = filtro;
    return Promise.resolve(this.linhas);
  }
}

describe('ServicoSync (C4.2)', () => {
  it('traduz o request em filtro (cursor→desde, municipios→escopoIds, produtos)', async () => {
    const fonte = new FonteStub([]);
    await new ServicoSync(fonte).delta({
      cursor: '2026-06-20T00:00:00.000Z',
      municipios: ['RJ:Rio de Janeiro', 'RJ'],
      produtoCanonicoIds: ['p-1'],
    });
    expect(fonte.filtro).toMatchObject({
      desde: '2026-06-20T00:00:00.000Z',
      escopoIds: ['RJ:Rio de Janeiro', 'RJ'],
      produtoCanonicoIds: ['p-1'],
    });
  });

  it('omite os filtros vazios (sync inicial sem cursor)', async () => {
    const fonte = new FonteStub([]);
    await new ServicoSync(fonte).delta({ municipios: [] });
    expect(fonte.filtro?.desde).toBeUndefined();
    expect(fonte.filtro?.escopoIds).toBeUndefined();
    expect(fonte.filtro?.produtoCanonicoIds).toBeUndefined();
  });

  it('deriva o novo cursor do maior atualizado_em retornado', async () => {
    const fonte = new FonteStub([
      estat({ atualizadoEm: '2026-06-21T00:00:00.000Z' }),
      estat({ atualizadoEm: '2026-06-25T00:00:00.000Z' }),
      estat({ atualizadoEm: '2026-06-23T00:00:00.000Z' }),
    ]);
    const r = await new ServicoSync(fonte).delta({});
    expect(r.estatisticas).toHaveLength(3);
    expect(r.cursor).toBe('2026-06-25T00:00:00.000Z');
  });

  it('mantém o cursor anterior quando nada mudou', async () => {
    const r = await new ServicoSync(new FonteStub([])).delta({
      cursor: '2026-06-20T00:00:00.000Z',
    });
    expect(r.cursor).toBe('2026-06-20T00:00:00.000Z');
  });
});

describe('RepositorioMemoria.deltaEstatisticas (C4.2)', () => {
  function linha(
    over: Partial<LinhaEstatistica> & Pick<LinhaEstatistica, 'produtoCanonicoId' | 'escopoId'>,
  ): LinhaEstatistica {
    return {
      escopo: 'municipio',
      unidadeBase: 'L',
      mediana: 5,
      p25: 4.5,
      p75: 5.5,
      minimo: 4,
      maximo: 6,
      nObservacoes: 8,
      ...over,
    };
  }

  it('filtra por escopo e por produto, e ordena por atualizado_em asc', async () => {
    const repo = new RepositorioMemoria();
    await repo.upsertEstatisticas([
      linha({ produtoCanonicoId: 'p-1', escopoId: 'RJ:Rio de Janeiro' }),
      linha({ produtoCanonicoId: 'p-2', escopoId: 'RJ:Rio de Janeiro' }),
      linha({ produtoCanonicoId: 'p-1', escopoId: 'SP:São Paulo' }),
    ]);

    const porEscopo = await repo.deltaEstatisticas({
      escopoIds: ['RJ:Rio de Janeiro'],
      limite: 100,
    });
    expect(porEscopo.map((e) => e.escopoId)).toEqual(['RJ:Rio de Janeiro', 'RJ:Rio de Janeiro']);

    const porProduto = await repo.deltaEstatisticas({ produtoCanonicoIds: ['p-1'], limite: 100 });
    expect(porProduto.every((e) => e.produtoCanonicoId === 'p-1')).toBe(true);
    expect(porProduto).toHaveLength(2);
  });

  it('aplica o cursor (atualizado_em estritamente maior)', async () => {
    const repo = new RepositorioMemoria();
    await repo.upsertEstatisticas([linha({ produtoCanonicoId: 'p-1', escopoId: 'RJ' })]);
    const [linhaGravada] = await repo.deltaEstatisticas({ limite: 100 });
    const cursor = linhaGravada!.atualizadoEm;

    expect(await repo.deltaEstatisticas({ desde: cursor, limite: 100 })).toHaveLength(0);
    expect(
      await repo.deltaEstatisticas({ desde: '2000-01-01T00:00:00.000Z', limite: 100 }),
    ).toHaveLength(1);
  });

  it('respeita o teto de linhas (limite)', async () => {
    const repo = new RepositorioMemoria();
    await repo.upsertEstatisticas([
      linha({ produtoCanonicoId: 'p-1', escopoId: 'RJ' }),
      linha({ produtoCanonicoId: 'p-2', escopoId: 'RJ' }),
      linha({ produtoCanonicoId: 'p-3', escopoId: 'RJ' }),
    ]);
    expect(await repo.deltaEstatisticas({ limite: 2 })).toHaveLength(2);
  });
});
