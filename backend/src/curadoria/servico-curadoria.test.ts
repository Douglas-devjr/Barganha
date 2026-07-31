import { describe, expect, it } from 'vitest';

import { ServicoConsulta } from '../consulta/servico-consulta';
import { LancamentoInvalidoError } from '../erros';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoCuradoria } from './servico-curadoria';

async function montar() {
  const repo = new RepositorioMemoria();
  const servico = new ServicoCuradoria(repo);
  const produtoCanonicoId = await repo.casarPorEan('7891234567890', {
    descricaoNormalizada: 'LEITE INTEGRAL 1L',
    unidadeBase: 'L',
  });
  return { repo, servico, produtoCanonicoId };
}

describe('ServicoCuradoria (C11.5)', () => {
  it('exige um alvo (id ou ean)', async () => {
    const { servico } = await montar();
    await expect(servico.enriquecer({ nomeExibicao: 'X' })).rejects.toBeInstanceOf(
      LancamentoInvalidoError,
    );
  });

  it('exige ao menos um campo a enriquecer', async () => {
    const { servico, produtoCanonicoId } = await montar();
    await expect(servico.enriquecer({ produtoCanonicoId })).rejects.toBeInstanceOf(
      LancamentoInvalidoError,
    );
  });

  it('devolve undefined quando o produto-alvo não existe (→ 404)', async () => {
    const { servico } = await montar();
    expect(await servico.enriquecer({ ean: '0000000000000', nomeExibicao: 'X' })).toBeUndefined();
  });

  it('enriquece por EAN e a consulta passa a expor o resumo do produto', async () => {
    const { repo, servico, produtoCanonicoId } = await montar();
    await repo.upsertEstatisticas([
      {
        produtoCanonicoId,
        escopo: 'uf',
        escopoId: 'RJ',
        unidadeBase: 'L',
        mediana: 5,
        p25: 4.5,
        p75: 5.5,
        minimo: 4,
        maximo: 6,
        nObservacoes: 20,
        observadoEmMaisRecente: '2026-06-20T00:00:00.000Z',
      },
    ]);

    const r = await servico.enriquecer({
      ean: '7891234567890',
      nomeExibicao: 'Leite Integral Tirol 1L',
      marca: 'Tirol',
      categoria: 'Laticínios',
      imagemUrl: 'https://cdn.barganha.app/p/leite.jpg',
    });
    expect(r).toEqual({ produtoCanonicoId });

    const consulta = new ServicoConsulta(repo, repo);
    const resposta = await consulta.consultar({ ean: '7891234567890', uf: 'RJ' });
    expect(resposta?.produto).toEqual({
      produtoCanonicoId,
      nomeExibicao: 'Leite Integral Tirol 1L',
      marca: 'Tirol',
      categoria: 'Laticínios',
      imagemUrl: 'https://cdn.barganha.app/p/leite.jpg',
      unidadeBase: 'L',
    });
  });

  it('antes do enriquecimento, a consulta já traz a unidade-base (sem campos humanos)', async () => {
    const { repo, produtoCanonicoId } = await montar();
    await repo.upsertEstatisticas([
      {
        produtoCanonicoId,
        escopo: 'uf',
        escopoId: 'RJ',
        unidadeBase: 'L',
        mediana: 5,
        p25: 4.5,
        p75: 5.5,
        minimo: 4,
        maximo: 6,
        nObservacoes: 20,
        observadoEmMaisRecente: '2026-06-20T00:00:00.000Z',
      },
    ]);
    const consulta = new ServicoConsulta(repo, repo);
    const resposta = await consulta.consultar({ ean: '7891234567890', uf: 'RJ' });
    expect(resposta?.produto).toEqual({ produtoCanonicoId, unidadeBase: 'L' });
  });
});
