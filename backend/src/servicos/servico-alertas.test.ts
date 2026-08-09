import { describe, expect, it } from 'vitest';

import { LancamentoInvalidoError } from '../erros';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';

import { ServicoAlertas } from './servico-alertas';

/** Cria dois produtos canônicos reais e devolve o serviço + os ids. */
async function montar() {
  const repo = new RepositorioMemoria();
  const arroz = await repo.casarPorEan('7891234560001', {
    descricaoNormalizada: 'ARROZ 5KG',
    unidadeBase: 'kg',
  });
  const feijao = await repo.casarPorEan('7891234560002', {
    descricaoNormalizada: 'FEIJAO 1KG',
    unidadeBase: 'kg',
  });
  return { repo, servico: new ServicoAlertas(repo), arroz, feijao };
}

describe('ServicoAlertas (C8.4)', () => {
  it('sincroniza um conjunto novo de alertas', async () => {
    const { repo, servico, arroz, feijao } = await montar();

    const r = await servico.sincronizar('u1', [
      {
        produtoCanonicoId: arroz,
        nome: 'Arroz 5kg',
        precoAlvo: 20,
        escopoGeo: 'RJ:RIO DE JANEIRO',
      },
      { produtoCanonicoId: feijao, nome: 'Feijão 1kg', precoAlvo: 7, escopoGeo: 'RJ' },
    ]);

    expect(r.total).toBe(2);
    expect(repo.alertasDoUsuario('u1')).toHaveLength(2);
  });

  it('substituição TOTAL: a 2ª chamada remove o que não veio de novo', async () => {
    const { repo, servico, arroz, feijao } = await montar();

    await servico.sincronizar('u1', [
      { produtoCanonicoId: arroz, nome: 'Arroz 5kg', precoAlvo: 20, escopoGeo: 'RJ' },
      { produtoCanonicoId: feijao, nome: 'Feijão 1kg', precoAlvo: 7, escopoGeo: 'RJ' },
    ]);
    await servico.sincronizar('u1', [
      { produtoCanonicoId: arroz, nome: 'Arroz 5kg', precoAlvo: 18, escopoGeo: 'RJ' },
    ]);

    const alvos = repo.alertasDoUsuario('u1');
    expect(alvos).toHaveLength(1);
    expect(alvos[0]).toMatchObject({ produtoCanonicoId: arroz, precoAlvo: 18 });
  });

  it('não afeta os alertas de outro usuário', async () => {
    const { repo, servico, arroz, feijao } = await montar();

    await servico.sincronizar('u1', [
      { produtoCanonicoId: arroz, nome: 'Arroz 5kg', precoAlvo: 20, escopoGeo: 'RJ' },
    ]);
    await servico.sincronizar('u2', [
      { produtoCanonicoId: feijao, nome: 'Feijão 1kg', precoAlvo: 7, escopoGeo: 'RJ' },
    ]);

    expect(repo.alertasDoUsuario('u1')).toHaveLength(1);
    expect(repo.alertasDoUsuario('u2')).toHaveLength(1);
  });

  it('dedup: mesmo produto duas vezes no mesmo payload mantém só a última ocorrência', async () => {
    const { repo, servico, arroz } = await montar();

    const r = await servico.sincronizar('u1', [
      { produtoCanonicoId: arroz, nome: 'Arroz 5kg', precoAlvo: 20, escopoGeo: 'RJ' },
      { produtoCanonicoId: arroz, nome: 'Arroz 5kg', precoAlvo: 15, escopoGeo: 'RJ' },
    ]);

    expect(r.total).toBe(1);
    expect(repo.alertasDoUsuario('u1')).toMatchObject([{ precoAlvo: 15 }]);
  });

  it('recusa precoAlvo <= 0', async () => {
    const { servico, arroz } = await montar();

    await expect(
      servico.sincronizar('u1', [
        { produtoCanonicoId: arroz, nome: 'Arroz 5kg', precoAlvo: 0, escopoGeo: 'RJ' },
      ]),
    ).rejects.toBeInstanceOf(LancamentoInvalidoError);
  });

  it('recusa mais alertas que o teto por usuário', async () => {
    const { servico, arroz } = await montar();
    const itens = Array.from({ length: 201 }, (_, i) => ({
      produtoCanonicoId: arroz,
      nome: `Produto ${i}`,
      precoAlvo: 1,
      escopoGeo: 'RJ',
    }));

    await expect(servico.sincronizar('u1', itens)).rejects.toBeInstanceOf(LancamentoInvalidoError);
  });

  it('apagarTodos remove o conjunto do usuário', async () => {
    const { repo, servico, arroz } = await montar();
    await servico.sincronizar('u1', [
      { produtoCanonicoId: arroz, nome: 'Arroz 5kg', precoAlvo: 20, escopoGeo: 'RJ' },
    ]);

    await servico.apagarTodos('u1');

    expect(repo.alertasDoUsuario('u1')).toHaveLength(0);
  });

  it('registra e remove dispositivo de push', async () => {
    const { repo, servico } = await montar();

    await servico.registrarDispositivo('u1', 'ExponentPushToken[abc]', 'android');
    expect(repo.dispositivosDoUsuario('u1')).toEqual(['ExponentPushToken[abc]']);

    await servico.removerDispositivo('ExponentPushToken[abc]');
    expect(repo.dispositivosDoUsuario('u1')).toHaveLength(0);
  });

  it('não deixa uma conta remover o token de push de OUTRA (escopo do dono)', async () => {
    // O token viaja no corpo do DELETE; sem o escopo do dono, quem o conhecesse
    // desligaria o push alheio (o backend fala pela service role, sem RLS).
    const { repo, servico } = await montar();
    await servico.registrarDispositivo('u1', 'ExponentPushToken[abc]', 'android');

    await servico.removerDispositivo('ExponentPushToken[abc]', 'u2');
    expect(repo.dispositivosDoUsuario('u1')).toEqual(['ExponentPushToken[abc]']);

    await servico.removerDispositivo('ExponentPushToken[abc]', 'u1');
    expect(repo.dispositivosDoUsuario('u1')).toHaveLength(0);
  });

  it('recusa token de push vazio', async () => {
    const { servico } = await montar();
    await expect(servico.registrarDispositivo('u1', '   ', 'ios')).rejects.toBeInstanceOf(
      LancamentoInvalidoError,
    );
  });
});
