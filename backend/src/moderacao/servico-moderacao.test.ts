import type { LancamentoManualRequest } from '@barganha/shared';
import { describe, expect, it } from 'vitest';

import { LancamentoInvalidoError } from '../erros';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoModeracao } from './servico-moderacao';

function montar() {
  const repo = new RepositorioMemoria();
  const servico = new ServicoModeracao(repo, repo);
  return { repo, servico };
}

const BASE: LancamentoManualRequest = {
  ean: '7891234567890',
  descricao: 'Leite Integral 1L',
  unidade: 'L',
  valorUnitario: 5.49,
  lojaCnpj: '12.345.678/0001-99',
  municipio: 'Rio de Janeiro',
  uf: 'RJ',
};

describe('ServicoModeracao (C11.3)', () => {
  it('recusa unidade não normalizável (não enfileira)', async () => {
    const { servico } = montar();
    await expect(servico.lancar('u1', { ...BASE, unidade: 'CX' })).rejects.toBeInstanceOf(
      LancamentoInvalidoError,
    );
  });

  it('recusa CNPJ inválido', async () => {
    const { servico } = montar();
    await expect(servico.lancar('u1', { ...BASE, lojaCnpj: '123' })).rejects.toBeInstanceOf(
      LancamentoInvalidoError,
    );
  });

  it('registra como pendente e a fila NÃO expõe o usuário', async () => {
    const { servico } = montar();
    const r = await servico.lancar('usuario-secreto', BASE);
    expect(r.status).toBe('pendente');
    expect(r.lancamentoId).toBeTruthy();

    const fila = await servico.listarFila();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({
      ean: BASE.ean,
      lojaCnpj: '12345678000199',
      status: 'pendente',
    });
    // Anti-abuso: o id do autor nunca sai na visão de curadoria.
    expect(JSON.stringify(fila[0])).not.toContain('usuario-secreto');
  });

  it('aprovar publica UMA observação anônima e normalizada no pool', async () => {
    const { repo, servico } = montar();
    const { lancamentoId } = await servico.lancar('u1', BASE);

    const dec = await servico.decidir(lancamentoId, { decisao: 'aprovar' });
    expect(dec).toEqual({ id: lancamentoId, status: 'aprovado' });

    const pool = repo.observacoesDoPool();
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({
      lojaCnpj: '12345678000199',
      municipio: 'Rio de Janeiro',
      uf: 'RJ',
      precoNormalizado: 5.49,
      unidadeBase: 'L',
      emPromocao: false,
    });
    // Sem amarra de pessoa: o pool é solto e anônimo (docs/04).
    expect(JSON.stringify(pool[0])).not.toContain('u1');
    expect('usuarioId' in pool[0]!).toBe(false);
    // Casou/criou o produto canônico por EAN.
    expect(repo.totalProdutos()).toBe(1);

    const fila = await servico.listarFila();
    expect(fila).toHaveLength(0);
  });

  it('rejeitar não publica nada e some da fila', async () => {
    const { repo, servico } = montar();
    const { lancamentoId } = await servico.lancar('u1', BASE);

    const dec = await servico.decidir(lancamentoId, {
      decisao: 'rejeitar',
      motivo: 'preço suspeito',
    });
    expect(dec).toEqual({ id: lancamentoId, status: 'rejeitado' });
    expect(repo.observacoesDoPool()).toHaveLength(0);
    expect(await servico.listarFila()).toHaveLength(0);
  });

  it('decidir é idempotente — re-aprovar não duplica no pool', async () => {
    const { repo, servico } = montar();
    const { lancamentoId } = await servico.lancar('u1', BASE);

    await servico.decidir(lancamentoId, { decisao: 'aprovar' });
    const segunda = await servico.decidir(lancamentoId, { decisao: 'aprovar' });
    expect(segunda).toEqual({ id: lancamentoId, status: 'aprovado' });
    expect(repo.observacoesDoPool()).toHaveLength(1);
  });

  it('decidir um id inexistente devolve undefined (→ 404)', async () => {
    const { servico } = montar();
    expect(await servico.decidir('nao-existe', { decisao: 'aprovar' })).toBeUndefined();
  });

  it('marca a promoção à parte do preço típico', async () => {
    const { repo, servico } = montar();
    const { lancamentoId } = await servico.lancar('u1', { ...BASE, emPromocao: true });
    await servico.decidir(lancamentoId, { decisao: 'aprovar' });
    expect(repo.observacoesDoPool()[0]?.emPromocao).toBe(true);
  });
});
