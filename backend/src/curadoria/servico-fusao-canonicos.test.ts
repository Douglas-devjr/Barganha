import { extrairObservacoesAnonimas } from '@barganha/shared';
import { describe, expect, it, vi } from 'vitest';

import { LancamentoInvalidoError } from '../erros';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoFusaoCanonicos } from './servico-fusao-canonicos';

/** Dois canônicos do MESMO produto físico, nascidos partidos por escrita diferente. */
async function fragmentos(repo: RepositorioMemoria) {
  const a = await repo.casarPorDescricao({
    descricaoNormalizada: 'CR LEITE X 200G',
    unidadeBase: 'un',
  });
  const b = await repo.casarPorDescricao({
    descricaoNormalizada: 'CREME DE LEITE X 200G',
    unidadeBase: 'un',
  });
  return { a, b };
}

function montar(repo: RepositorioMemoria) {
  const recalcular = vi.fn(() => Promise.resolve());
  return { servico: new ServicoFusaoCanonicos(repo, recalcular), recalcular };
}

describe('ServicoFusaoCanonicos (C3.6.1)', () => {
  it('recusa fundir um produto com ele mesmo', async () => {
    const repo = new RepositorioMemoria();
    const { a } = await fragmentos(repo);
    const { servico } = montar(repo);
    await expect(servico.fundir(a, a)).rejects.toBeInstanceOf(LancamentoInvalidoError);
  });

  it('recusa alvo inexistente', async () => {
    const repo = new RepositorioMemoria();
    const { a } = await fragmentos(repo);
    const { servico } = montar(repo);
    await expect(servico.fundir(a, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      /vencedor não encontrado/i,
    );
  });

  it('recusa unidades-base diferentes — fundir misturaria escalas de preço', async () => {
    const repo = new RepositorioMemoria();
    const kg = await repo.casarPorDescricao({
      descricaoNormalizada: 'QUEIJO MUSSARELA',
      unidadeBase: 'kg',
    });
    const un = await repo.casarPorDescricao({
      descricaoNormalizada: 'QUEIJO MUSSARELA FATIADO',
      unidadeBase: 'un',
    });
    const { servico } = montar(repo);
    await expect(servico.fundir(kg, un)).rejects.toThrow(/unidades-base diferentes/i);
  });

  it('recusa fundir dois EANs reais distintos — são produtos diferentes', async () => {
    const repo = new RepositorioMemoria();
    const a = await repo.casarPorEan('7891000100103', {
      descricaoNormalizada: 'LEITE INTEGRAL 1L',
      unidadeBase: 'L',
    });
    const b = await repo.casarPorEan('7891000100110', {
      descricaoNormalizada: 'LEITE DESNATADO 1L',
      unidadeBase: 'L',
    });
    const { servico } = montar(repo);
    await expect(servico.fundir(a, b)).rejects.toThrow(/ambos têm ean/i);
  });

  it('recusa quando o PERDEDOR é o único com EAN — não joga fora a identidade forte', async () => {
    const repo = new RepositorioMemoria();
    const comEan = await repo.casarPorEan('7891000100103', {
      descricaoNormalizada: 'LEITE INTEGRAL 1L',
      unidadeBase: 'L',
    });
    const semEan = await repo.casarPorDescricao({
      descricaoNormalizada: 'LEITE INT 1L',
      unidadeBase: 'L',
    });
    const { servico } = montar(repo);
    await expect(servico.fundir(comEan, semEan)).rejects.toThrow(/inverta a ordem/i);
    // Na ordem certa passa.
    await expect(servico.fundir(semEan, comEan)).resolves.toBeTruthy();
  });

  it('reaponta o pool: duas amostras partidas viram uma série só', async () => {
    const repo = new RepositorioMemoria();
    const { a, b } = await fragmentos(repo);
    repo.semearObservacoes([...poolDe(a, [5.5, 5.9]), ...poolDe(b, [6.1])]);

    const { servico, recalcular } = montar(repo);
    const resumo = await servico.fundir(a, b);

    expect(resumo.observacoesRepontadas).toBe(2);
    expect(recalcular).toHaveBeenCalledWith(b);
    expect(await repo.observacoesDoProduto(b)).toHaveLength(3);
    expect(await repo.observacoesDoProduto(a)).toHaveLength(0);
  });

  it('grava o alias da descrição do perdedor — senão a fusão se desfaz no próximo cupom', async () => {
    const repo = new RepositorioMemoria();
    const { a, b } = await fragmentos(repo);
    const { servico } = montar(repo);
    await servico.fundir(a, b);

    // O cupom seguinte com a descrição ANTIGA tem de cair no vencedor, e não
    // recriar o fragmento que a fusão acabou de eliminar.
    const alias = await repo.buscarAliasConfirmado('CR LEITE X 200G', 'un');
    expect(alias).toBe(b);
  });

  it('o perdedor deixa de existir depois da fusão', async () => {
    const repo = new RepositorioMemoria();
    const { a, b } = await fragmentos(repo);
    const { servico } = montar(repo);
    await servico.fundir(a, b);
    expect(await repo.obterCanonicoParaFusao(a)).toBeUndefined();
    expect(await repo.obterCanonicoParaFusao(b)).toBeTruthy();
  });

  it('reaponta os mapeamentos loja+código para o vencedor', async () => {
    const repo = new RepositorioMemoria();
    const { a, b } = await fragmentos(repo);
    await repo.registrarMapeamento({
      lojaCnpj: '31698759001780',
      codigo: '214184',
      produtoCanonicoId: a,
      unidadeBase: 'un',
      descricaoReferencia: 'CR LEITE X 200G',
      origem: 'descricao_exata',
    });

    const { servico } = montar(repo);
    const resumo = await servico.fundir(a, b);

    expect(resumo.codigosRepontados).toBe(1);
    const m = await repo.buscarMapeamento('31698759001780', '214184');
    expect(m?.produtoCanonicoId).toBe(b);
  });
});

/**
 * Observações do pool para um canônico. Passa pelo GATE de verdade
 * (`extrairObservacoesAnonimas`) porque `ObservacaoAnonima` é um tipo marcado —
 * nem o teste tem atalho para o pool (docs/04).
 */
function poolDe(produtoCanonicoId: string, precos: number[]) {
  return extrairObservacoesAnonimas({
    loja: { cnpj: '31698759001780', municipio: 'RIO DE JANEIRO', uf: 'RJ' },
    observadoEm: '2026-07-01T10:00:00.000Z',
    itens: precos.map((precoNormalizado) => ({
      produtoCanonicoId,
      precoNormalizado,
      unidadeBase: 'un' as const,
      emPromocao: false,
    })),
    usuarioId: 'user-descartado',
    cupomId: 'cupom-descartado',
  });
}
