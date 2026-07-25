import type { PrecoEstatistica } from '@barganha/shared';
import { describe, expect, it } from 'vitest';

import type { LinhaEstatistica } from '../estatistica/tipos';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { lerCursor, ServicoSync } from './servico-sync';
import type { FiltroDeltaSync, FonteDeltaSync, LinhaDelta } from './tipos';

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
  constructor(private readonly linhas: LinhaDelta[]) {}
  deltaEstatisticas(filtro: FiltroDeltaSync): Promise<LinhaDelta[]> {
    this.filtro = filtro;
    return Promise.resolve(this.linhas);
  }
}

/** Açúcar: linha do delta com a posição keyset. */
const delta = (atualizadoEm: string, seq: number): LinhaDelta => ({
  estatistica: estat({ atualizadoEm }),
  seq,
});

describe('ServicoSync (C4.2)', () => {
  it('traduz o request em filtro (cursor→desde, municipios→escopoIds, produtos)', async () => {
    const fonte = new FonteStub([]);
    await new ServicoSync(fonte).delta({
      cursor: '2026-06-20T00:00:00.000Z|42',
      municipios: ['RJ:Rio de Janeiro', 'RJ'],
      produtoCanonicoIds: ['p-1'],
    });
    expect(fonte.filtro).toMatchObject({
      desde: { atualizadoEm: '2026-06-20T00:00:00.000Z', seq: 42 },
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

  it('deriva o novo cursor da ÚLTIMA linha (posição keyset, não do máximo)', async () => {
    const fonte = new FonteStub([
      delta('2026-06-21T00:00:00.000Z', 1),
      delta('2026-06-25T00:00:00.000Z', 2),
      delta('2026-06-25T00:00:00.000Z', 3),
    ]);
    const r = await new ServicoSync(fonte).delta({});
    expect(r.estatisticas).toHaveLength(3);
    expect(r.cursor).toBe('2026-06-25T00:00:00.000Z|3');
  });

  it('mantém o cursor anterior quando nada mudou', async () => {
    const r = await new ServicoSync(new FonteStub([])).delta({
      cursor: '2026-06-20T00:00:00.000Z|7',
    });
    expect(r.cursor).toBe('2026-06-20T00:00:00.000Z|7');
  });

  it('sinaliza temMais quando a página enche o teto', async () => {
    const cheia = new FonteStub([delta('2026-06-21T00:00:00.000Z', 1)]);
    expect((await new ServicoSync(cheia, 1).delta({})).temMais).toBe(true);

    const folgada = new FonteStub([delta('2026-06-21T00:00:00.000Z', 1)]);
    expect((await new ServicoSync(folgada, 10).delta({})).temMais).toBeUndefined();
  });

  it('não desce LOJA abaixo do piso — e o cursor NÃO rebobina (docs/04)', async () => {
    // Sem filtro de município (usuário sem região escolhida) o delta traria todo
    // escopo, inclusive loja com n=1. A linha é suprimida, mas a posição keyset
    // tem de continuar vindo da página CRUA: derivar o cursor do que sobrou
    // faria o sync repetir a mesma página para sempre.
    const fonte = new FonteStub([
      { estatistica: estat({ atualizadoEm: '2026-06-21T00:00:00.000Z' }), seq: 1 },
      {
        estatistica: estat({
          atualizadoEm: '2026-06-22T00:00:00.000Z',
          escopo: 'loja',
          escopoId: '12345678000199',
          nObservacoes: 1,
        }),
        seq: 2,
      },
    ]);
    const r = await new ServicoSync(fonte).delta({});

    expect(r.estatisticas.map((e) => e.escopo)).toEqual(['municipio']);
    expect(r.cursor).toBe('2026-06-22T00:00:00.000Z|2');
  });

  it('deixa passar a LOJA que já amadureceu (n no piso)', async () => {
    const fonte = new FonteStub([
      {
        estatistica: estat({
          atualizadoEm: '2026-06-21T00:00:00.000Z',
          escopo: 'loja',
          escopoId: '12345678000199',
          nObservacoes: 3,
        }),
        seq: 1,
      },
    ]);
    expect((await new ServicoSync(fonte).delta({})).estatisticas).toHaveLength(1);
  });

  it('aceita o cursor ANTIGO (só ISO, sem seq) sem perder linhas', () => {
    // Cliente já instalado tem o formato v1 no SQLite. Retomar do começo
    // daquele instante (seq -1) reenvia algumas linhas — inofensivo, o cache
    // faz upsert — mas nunca PULA nenhuma.
    expect(lerCursor('2026-06-20T00:00:00.000Z')).toEqual({
      atualizadoEm: '2026-06-20T00:00:00.000Z',
      seq: -1,
    });
    expect(lerCursor(undefined)).toBeUndefined();
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
    expect(porEscopo.map((l) => l.estatistica.escopoId)).toEqual([
      'RJ:Rio de Janeiro',
      'RJ:Rio de Janeiro',
    ]);

    const porProduto = await repo.deltaEstatisticas({ produtoCanonicoIds: ['p-1'], limite: 100 });
    expect(porProduto.every((l) => l.estatistica.produtoCanonicoId === 'p-1')).toBe(true);
    expect(porProduto).toHaveLength(2);
  });

  it('aplica o cursor keyset (nada se repete a partir da última posição)', async () => {
    const repo = new RepositorioMemoria();
    await repo.upsertEstatisticas([linha({ produtoCanonicoId: 'p-1', escopoId: 'RJ' })]);
    const [gravada] = await repo.deltaEstatisticas({ limite: 100 });
    const cursor = { atualizadoEm: gravada!.estatistica.atualizadoEm, seq: gravada!.seq };

    expect(await repo.deltaEstatisticas({ desde: cursor, limite: 100 })).toHaveLength(0);
    expect(
      await repo.deltaEstatisticas({
        desde: { atualizadoEm: '2000-01-01T00:00:00.000Z', seq: 0 },
        limite: 100,
      }),
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

  it('REGRESSÃO: paginar dentro de um lote de mesmo atualizado_em não pula linhas', async () => {
    // O bug: `upsertEstatisticas` carimba o MESMO instante em todo o lote. Com
    // cursor só por `atualizado_em` e filtro `>`, a 2ª página pulava o resto do
    // lote — para sempre. Aqui as 3 linhas nascem no mesmo upsert (mesmo
    // timestamp) e são paginadas de 1 em 1: nenhuma pode sumir.
    const repo = new RepositorioMemoria();
    await repo.upsertEstatisticas([
      linha({ produtoCanonicoId: 'p-1', escopoId: 'RJ' }),
      linha({ produtoCanonicoId: 'p-2', escopoId: 'RJ' }),
      linha({ produtoCanonicoId: 'p-3', escopoId: 'RJ' }),
    ]);
    const servico = new ServicoSync(repo, 1);

    const vistos: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await servico.delta({ ...(cursor ? { cursor } : {}) });
      vistos.push(...r.estatisticas.map((e) => e.produtoCanonicoId));
      cursor = r.cursor;
      if (!r.temMais || r.estatisticas.length === 0) break;
    }
    expect(vistos.sort()).toEqual(['p-1', 'p-2', 'p-3']);
  });
});
