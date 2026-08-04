import { describe, expect, it } from 'vitest';

import { RepositorioMemoria } from '../persistencia/repositorio-memoria';

import { ServicoAssinatura } from './servico-assinatura';

describe('ServicoAssinatura (C13.2)', () => {
  it('sem linha em assinatura → gratis (o padrão, nunca o contrário)', async () => {
    const repo = new RepositorioMemoria();
    const servico = new ServicoAssinatura(repo);

    await expect(servico.obterEstado('u1')).resolves.toEqual({ plano: 'gratis' });
  });

  it('linha plus com validoAte no futuro → plus', async () => {
    const repo = new RepositorioMemoria();
    const futuro = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    repo.semearAssinatura('u1', { plano: 'plus', validoAte: futuro });
    const servico = new ServicoAssinatura(repo);

    await expect(servico.obterEstado('u1')).resolves.toEqual({ plano: 'plus', validoAte: futuro });
  });

  it('linha plus com validoAte no passado → gratis (expirado, nunca confia num plus vencido)', async () => {
    const repo = new RepositorioMemoria();
    const passado = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    repo.semearAssinatura('u1', { plano: 'plus', validoAte: passado });
    const servico = new ServicoAssinatura(repo);

    await expect(servico.obterEstado('u1')).resolves.toEqual({ plano: 'gratis' });
  });

  it('linha plus sem validoAte (vitalício, ex. plus_contribuindo renovado) → plus', async () => {
    const repo = new RepositorioMemoria();
    repo.semearAssinatura('u1', { plano: 'plus', validoAte: null });
    const servico = new ServicoAssinatura(repo);

    await expect(servico.obterEstado('u1')).resolves.toEqual({ plano: 'plus' });
  });

  it('validoAte ilegível (NaN) → gratis (falha fechada, nunca concede por default)', async () => {
    const repo = new RepositorioMemoria();
    repo.semearAssinatura('u1', { plano: 'plus', validoAte: 'data-invalida' });
    const servico = new ServicoAssinatura(repo);

    await expect(servico.obterEstado('u1')).resolves.toEqual({ plano: 'gratis' });
  });

  it('não vaza o plano de uma conta para outra', async () => {
    const repo = new RepositorioMemoria();
    repo.semearAssinatura('u1', { plano: 'plus', validoAte: null });
    const servico = new ServicoAssinatura(repo);

    await expect(servico.obterEstado('u2')).resolves.toEqual({ plano: 'gratis' });
  });
});
