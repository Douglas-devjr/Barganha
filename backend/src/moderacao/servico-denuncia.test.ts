import { describe, expect, it } from 'vitest';

import { LancamentoInvalidoError } from '../erros';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';

import { ServicoDenuncia } from './servico-denuncia';

/** Cria um produto canônico real e devolve o serviço + o id do alvo. */
async function montar() {
  const repo = new RepositorioMemoria();
  const produtoCanonicoId = await repo.casarPorEan('7891234567890', {
    descricaoNormalizada: 'LEITE INTEGRAL 1L',
    unidadeBase: 'L',
  });
  return { repo, servico: new ServicoDenuncia(repo), produtoCanonicoId };
}

describe('ServicoDenuncia (C12.5)', () => {
  it('registra a denúncia como pendente', async () => {
    const { servico, produtoCanonicoId } = await montar();

    const r = await servico.denunciar('u1', {
      produtoCanonicoId,
      motivo: 'preco_divergente',
      municipio: 'Rio de Janeiro',
      uf: 'RJ',
    });

    expect(r.status).toBe('pendente');
    expect(r.jaRegistrada).toBe(false);
    expect(r.id).toBeTruthy();
  });

  it('recusa motivo desconhecido', async () => {
    const { servico, produtoCanonicoId } = await montar();

    await expect(
      // @ts-expect-error — motivo fora do enum é exatamente o que se testa
      servico.denunciar('u1', { produtoCanonicoId, motivo: 'nao_gostei' }),
    ).rejects.toBeInstanceOf(LancamentoInvalidoError);
  });

  it('recusa denúncia órfã (produto inexistente)', async () => {
    const { servico } = await montar();

    await expect(
      servico.denunciar('u1', {
        produtoCanonicoId: '00000000-0000-0000-0000-000000000000',
        motivo: 'produto_errado',
      }),
    ).rejects.toBeInstanceOf(LancamentoInvalidoError);
  });

  it('não empilha: a 2ª denúncia da mesma pessoa p/ o mesmo produto devolve a aberta', async () => {
    const { servico, produtoCanonicoId } = await montar();

    const primeira = await servico.denunciar('u1', { produtoCanonicoId, motivo: 'unidade_errada' });
    const segunda = await servico.denunciar('u1', { produtoCanonicoId, motivo: 'outro' });

    expect(segunda.jaRegistrada).toBe(true);
    expect(segunda.id).toBe(primeira.id);
    expect(await servico.listarFila()).toHaveLength(1);
  });

  it('a fila NÃO expõe o usuário e conta o volume por produto', async () => {
    const { servico, produtoCanonicoId } = await montar();
    await servico.denunciar('u1', { produtoCanonicoId, motivo: 'preco_divergente' });
    await servico.denunciar('u2', { produtoCanonicoId, motivo: 'produto_errado' });

    const fila = await servico.listarFila();

    expect(fila).toHaveLength(2);
    for (const d of fila) {
      // O autor é anti-abuso e mora só no lado privado (docs/04).
      expect(d).not.toHaveProperty('usuarioId');
      expect(d.abertasNoProduto).toBe(2);
    }
  });

  it('corta comentário gigante em vez de guardar despejo', async () => {
    const { servico, produtoCanonicoId } = await montar();

    await servico.denunciar('u1', {
      produtoCanonicoId,
      motivo: 'outro',
      comentario: 'x'.repeat(900),
    });

    const [d] = await servico.listarFila();
    expect(d?.comentario).toHaveLength(500);
  });

  it('decidir fecha a denúncia e some da fila; decidir de novo devolve false', async () => {
    const { servico, produtoCanonicoId } = await montar();
    const { id } = await servico.denunciar('u1', { produtoCanonicoId, motivo: 'preco_divergente' });

    expect(await servico.decidir(id, true, 'unidade corrigida')).toBe(true);
    expect(await servico.listarFila()).toHaveLength(0);
    expect(await servico.decidir(id, true)).toBe(false);
  });

  it('denunciar NÃO escreve no pool anônimo', async () => {
    const { repo, servico, produtoCanonicoId } = await montar();
    const antes = repo.observacoesDoPool().length;

    await servico.denunciar('u1', { produtoCanonicoId, motivo: 'preco_divergente' });

    // A denúncia é sinal de curadoria: nenhum caminho de escrita em observacao_preco.
    expect(repo.observacoesDoPool()).toHaveLength(antes);
  });

  it('depois de decidida, a pessoa pode denunciar o mesmo produto de novo', async () => {
    const { servico, produtoCanonicoId } = await montar();
    const { id } = await servico.denunciar('u1', { produtoCanonicoId, motivo: 'preco_divergente' });
    await servico.decidir(id, false);

    const nova = await servico.denunciar('u1', { produtoCanonicoId, motivo: 'preco_divergente' });

    expect(nova.jaRegistrada).toBe(false);
    expect(nova.id).not.toBe(id);
  });
});
