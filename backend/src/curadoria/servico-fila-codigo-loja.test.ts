import { describe, expect, it } from 'vitest';

import { LancamentoInvalidoError } from '../erros';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoFilaCodigoLoja } from './servico-fila-codigo-loja';

const LOJA_CNPJ = '31698759001780';
const CODIGO = '214184';

/** Cria um mapeamento e o marca `suspeito` — fixture da fila (C3.6.2). */
async function mapeamentoSuspeito(
  repo: RepositorioMemoria,
  opcoes: {
    lojaCnpj?: string;
    codigo?: string;
    produtoCanonicoId: string;
    unidadeBase?: 'un' | 'kg' | 'L';
  },
) {
  const lojaCnpj = opcoes.lojaCnpj ?? LOJA_CNPJ;
  const codigo = opcoes.codigo ?? CODIGO;
  await repo.registrarMapeamento({
    lojaCnpj,
    codigo,
    produtoCanonicoId: opcoes.produtoCanonicoId,
    unidadeBase: opcoes.unidadeBase ?? 'un',
    descricaoReferencia: 'CR LEITE X 200G',
    origem: 'descricao_exata',
  });
  await repo.marcarMapeamentoSuspeito(lojaCnpj, codigo, 'descricao_divergente');
  return { lojaCnpj, codigo };
}

describe('ServicoFilaCodigoLoja (C3.6.2)', () => {
  it('recusa confirmar sem lojaCnpj/codigo', async () => {
    const servico = new ServicoFilaCodigoLoja(new RepositorioMemoria());
    await expect(servico.confirmar('', 'x')).rejects.toBeInstanceOf(LancamentoInvalidoError);
    await expect(servico.confirmar('12345678000199', '')).rejects.toBeInstanceOf(
      LancamentoInvalidoError,
    );
  });

  it('recusa reapontar sem os três campos', async () => {
    const servico = new ServicoFilaCodigoLoja(new RepositorioMemoria());
    await expect(servico.reapontar('', 'x', 'id')).rejects.toBeInstanceOf(LancamentoInvalidoError);
    await expect(servico.reapontar('12345678000199', '', 'id')).rejects.toBeInstanceOf(
      LancamentoInvalidoError,
    );
    await expect(servico.reapontar('12345678000199', 'x', '')).rejects.toBeInstanceOf(
      LancamentoInvalidoError,
    );
  });

  it('confirmar em par inexistente devolve false (404 na rota)', async () => {
    const servico = new ServicoFilaCodigoLoja(new RepositorioMemoria());
    await expect(servico.confirmar('12345678000199', 'nao-existe')).resolves.toBe(false);
  });

  it('confirmar mantém o produto atual e volta a ativo — some da fila', async () => {
    const repo = new RepositorioMemoria();
    const produtoId = await repo.casarPorDescricao({
      descricaoNormalizada: 'CR LEITE X 200G',
      unidadeBase: 'un',
    });
    const { lojaCnpj, codigo } = await mapeamentoSuspeito(repo, { produtoCanonicoId: produtoId });
    const servico = new ServicoFilaCodigoLoja(repo);

    expect((await servico.listar()).length).toBe(1);
    await expect(servico.confirmar(lojaCnpj, codigo)).resolves.toBe(true);

    expect(await servico.listar()).toHaveLength(0);
    const m = await repo.buscarMapeamento(lojaCnpj, codigo);
    expect(m?.status).toBe('ativo');
    expect(m?.produtoCanonicoId).toBe(produtoId);
  });

  it('reapontar em par inexistente → nao_encontrado', async () => {
    const repo = new RepositorioMemoria();
    const produtoId = await repo.casarPorDescricao({
      descricaoNormalizada: 'X',
      unidadeBase: 'un',
    });
    const servico = new ServicoFilaCodigoLoja(repo);
    await expect(servico.reapontar('12345678000199', 'nao-existe', produtoId)).resolves.toBe(
      'nao_encontrado',
    );
  });

  it('reapontar para produto inexistente → produto_nao_encontrado, mapeamento intacto', async () => {
    const repo = new RepositorioMemoria();
    const produtoId = await repo.casarPorDescricao({
      descricaoNormalizada: 'CR LEITE X 200G',
      unidadeBase: 'un',
    });
    const { lojaCnpj, codigo } = await mapeamentoSuspeito(repo, { produtoCanonicoId: produtoId });
    const servico = new ServicoFilaCodigoLoja(repo);

    await expect(
      servico.reapontar(lojaCnpj, codigo, '00000000-0000-0000-0000-000000000000'),
    ).resolves.toBe('produto_nao_encontrado');

    const m = await repo.buscarMapeamento(lojaCnpj, codigo);
    expect(m?.status).toBe('suspeito');
    expect(m?.produtoCanonicoId).toBe(produtoId);
  });

  it('reapontar com unidade-base divergente → unidade_divergente, sem tocar a linha', async () => {
    const repo = new RepositorioMemoria();
    const produtoOrigemId = await repo.casarPorDescricao({
      descricaoNormalizada: 'CR LEITE X 200G',
      unidadeBase: 'un',
    });
    const produtoKg = await repo.casarPorDescricao({
      descricaoNormalizada: 'QUEIJO MUSSARELA',
      unidadeBase: 'kg',
    });
    const { lojaCnpj, codigo } = await mapeamentoSuspeito(repo, {
      produtoCanonicoId: produtoOrigemId,
      unidadeBase: 'un',
    });
    const servico = new ServicoFilaCodigoLoja(repo);

    await expect(servico.reapontar(lojaCnpj, codigo, produtoKg)).resolves.toBe(
      'unidade_divergente',
    );

    const m = await repo.buscarMapeamento(lojaCnpj, codigo);
    expect(m?.status).toBe('suspeito');
    expect(m?.produtoCanonicoId).toBe(produtoOrigemId);
  });

  it('reapontar válido: troca o produto e reabilita — some da fila', async () => {
    const repo = new RepositorioMemoria();
    const produtoErrado = await repo.casarPorDescricao({
      descricaoNormalizada: 'CR LEITE X 200G',
      unidadeBase: 'un',
    });
    const produtoCerto = await repo.casarPorDescricao({
      descricaoNormalizada: 'CREME DE LEITE X 200G',
      unidadeBase: 'un',
    });
    const { lojaCnpj, codigo } = await mapeamentoSuspeito(repo, {
      produtoCanonicoId: produtoErrado,
    });
    const servico = new ServicoFilaCodigoLoja(repo);

    await expect(servico.reapontar(lojaCnpj, codigo, produtoCerto)).resolves.toBe('ok');

    expect(await servico.listar()).toHaveLength(0);
    const m = await repo.buscarMapeamento(lojaCnpj, codigo);
    expect(m?.status).toBe('ativo');
    expect(m?.produtoCanonicoId).toBe(produtoCerto);
  });

  it('listar traz o contexto (loja, produto atual) que o curador precisa ver', async () => {
    const repo = new RepositorioMemoria();
    repo.semearLoja({ cnpj: LOJA_CNPJ, razaoSocial: 'MERCADO TESTE LTDA', uf: 'RJ' });
    const produtoId = await repo.casarPorEan('7891000100103', {
      descricaoNormalizada: 'CR LEITE X 200G',
      unidadeBase: 'un',
    });
    await mapeamentoSuspeito(repo, { produtoCanonicoId: produtoId });
    const servico = new ServicoFilaCodigoLoja(repo);

    const [item] = await servico.listar();
    expect(item).toBeDefined();
    expect(item?.lojaCnpj).toBe(LOJA_CNPJ);
    expect(item?.lojaRazaoSocial).toBe('MERCADO TESTE LTDA');
    expect(item?.codigo).toBe(CODIGO);
    expect(item?.status).toBe('suspeito');
    expect(item?.motivoSuspeita).toBe('descricao_divergente');
    expect(item?.hits).toBeGreaterThanOrEqual(1);
    expect(item?.produtoCanonico.id).toBe(produtoId);
    expect(item?.produtoCanonico.ean).toBe('7891000100103');
  });

  it('limite é respeitado e tem teto de servidor', async () => {
    const repo = new RepositorioMemoria();
    for (let i = 0; i < 3; i++) {
      const produtoId = await repo.casarPorDescricao({
        descricaoNormalizada: `PRODUTO ${i}`,
        unidadeBase: 'un',
      });
      await mapeamentoSuspeito(repo, { produtoCanonicoId: produtoId, codigo: `SKU-${i}` });
    }
    const servico = new ServicoFilaCodigoLoja(repo);
    expect(await servico.listar(2)).toHaveLength(2);
    expect(await servico.listar(0)).toHaveLength(1); // clampado para o mínimo 1
  });
});
