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

describe('ServicoCuradoria.buscar (C11.5 — busca paginada)', () => {
  it('exige um termo não vazio', async () => {
    const { servico } = await montar();
    await expect(servico.buscar('')).rejects.toBeInstanceOf(LancamentoInvalidoError);
    await expect(servico.buscar('   ')).rejects.toBeInstanceOf(LancamentoInvalidoError);
  });

  it('encontra por nome (nome de exibição), ignorando maiúsculas/minúsculas', async () => {
    const { repo, servico, produtoCanonicoId } = await montar();
    await repo.enriquecerProduto({ produtoCanonicoId, nomeExibicao: 'Leite Tirol 1L' });

    const r = await servico.buscar('tirol');
    expect(r.total).toBe(1);
    expect(r.itens).toEqual([
      { produtoCanonicoId, ean: '7891234567890', nomeExibicao: 'Leite Tirol 1L' },
    ]);
    expect(r.pagina).toBe(1);
    expect(r.tamanhoPagina).toBe(20);
  });

  it('encontra por EAN (prefixo)', async () => {
    const { servico } = await montar();
    const r = await servico.buscar('789123');
    expect(r.total).toBe(1);
    expect(r.itens[0]?.ean).toBe('7891234567890');
  });

  it('encontra por descrição normalizada quando não há nome de exibição', async () => {
    const { servico } = await montar();
    const r = await servico.buscar('leite integral');
    expect(r.total).toBe(1);
  });

  it('termo sem correspondência → página vazia, total zero', async () => {
    const { servico } = await montar();
    const r = await servico.buscar('produto-que-nao-existe-xyz');
    expect(r.itens).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('pagina resultados e aplica defaults/teto de tamanho de página', async () => {
    const repo = new RepositorioMemoria();
    const servico = new ServicoCuradoria(repo);
    for (let i = 0; i < 5; i++) {
      await repo.casarPorEan(`700000000000${i}`, {
        descricaoNormalizada: `PRODUTO TESTE ${i}`,
        unidadeBase: 'un',
      });
    }

    const pagina1 = await servico.buscar('produto teste', 1, 2);
    expect(pagina1.itens.length).toBe(2);
    expect(pagina1.total).toBe(5);
    expect(pagina1.pagina).toBe(1);
    expect(pagina1.tamanhoPagina).toBe(2);

    const pagina3 = await servico.buscar('produto teste', 3, 2);
    expect(pagina3.itens.length).toBe(1);
    expect(pagina3.total).toBe(5);

    // Página abaixo de 1 é corrigida para 1; tamanho acima do teto é cortado.
    const corrigida = await servico.buscar('produto teste', 0, 10_000);
    expect(corrigida.pagina).toBe(1);
    expect(corrigida.tamanhoPagina).toBe(100);
  });
});
