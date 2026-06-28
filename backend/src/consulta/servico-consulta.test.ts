import { describe, expect, it } from 'vitest';

import type { LinhaEstatistica } from '../estatistica/tipos';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoConsulta } from './servico-consulta';

function linha(
  over: Partial<LinhaEstatistica> & Pick<LinhaEstatistica, 'produtoCanonicoId'>,
): LinhaEstatistica {
  return {
    escopo: 'municipio',
    escopoId: 'RJ:Rio de Janeiro',
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

async function montar() {
  const repo = new RepositorioMemoria();
  const servico = new ServicoConsulta(repo, repo);
  return { repo, servico };
}

describe('ServicoConsulta (C4.1)', () => {
  it('resolve por EAN no município quando há base suficiente', async () => {
    const { repo, servico } = await montar();
    const pid = await repo.casarPorEan('789', {
      descricaoNormalizada: 'LEITE 1L',
      unidadeBase: 'L',
    });
    await repo.upsertEstatisticas([
      linha({
        produtoCanonicoId: pid,
        escopo: 'municipio',
        escopoId: 'RJ:Rio de Janeiro',
        nObservacoes: 5,
      }),
      linha({ produtoCanonicoId: pid, escopo: 'uf', escopoId: 'RJ', nObservacoes: 50 }),
    ]);

    const r = await servico.consultar({ ean: '789', municipio: 'Rio de Janeiro', uf: 'RJ' });
    expect(r?.produtoCanonicoId).toBe(pid);
    expect(r?.escopoResolvido).toBe('municipio');
    expect(r?.estatistica.escopoId).toBe('RJ:Rio de Janeiro');
  });

  it('sobe para UF quando o município não atinge o mínimo de observações', async () => {
    const { repo, servico } = await montar();
    const pid = await repo.casarPorEan('789', {
      descricaoNormalizada: 'LEITE 1L',
      unidadeBase: 'L',
    });
    await repo.upsertEstatisticas([
      linha({
        produtoCanonicoId: pid,
        escopo: 'municipio',
        escopoId: 'RJ:Rio de Janeiro',
        nObservacoes: 2,
      }),
      linha({ produtoCanonicoId: pid, escopo: 'uf', escopoId: 'RJ', nObservacoes: 30 }),
    ]);

    const r = await servico.consultar({ ean: '789', municipio: 'Rio de Janeiro', uf: 'RJ' });
    expect(r?.escopoResolvido).toBe('uf');
  });

  it('resolve por nome via casamento de texto', async () => {
    const { repo, servico } = await montar();
    const pid = await repo.casarPorEan('789', {
      descricaoNormalizada: 'ARROZ TIPO 1 5KG',
      unidadeBase: 'kg',
    });
    await repo.upsertEstatisticas([
      linha({
        produtoCanonicoId: pid,
        escopo: 'uf',
        escopoId: 'RJ',
        unidadeBase: 'kg',
        nObservacoes: 12,
      }),
    ]);

    const r = await servico.consultar({ nome: 'arroz tipo 1', uf: 'RJ' });
    expect(r?.produtoCanonicoId).toBe(pid);
  });

  it('devolve undefined quando o EAN não existe na base', async () => {
    const { servico } = await montar();
    expect(await servico.consultar({ ean: 'inexistente', uf: 'RJ' })).toBeUndefined();
  });

  it('devolve undefined quando o produto existe mas não há estatística no escopo', async () => {
    const { repo, servico } = await montar();
    await repo.casarPorEan('789', { descricaoNormalizada: 'LEITE 1L', unidadeBase: 'L' });
    expect(
      await servico.consultar({ ean: '789', municipio: 'Rio de Janeiro', uf: 'RJ' }),
    ).toBeUndefined();
  });
});
