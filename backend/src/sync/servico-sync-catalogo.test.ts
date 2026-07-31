import type { ProdutoResumo } from '@barganha/shared';
import { describe, expect, it } from 'vitest';

import { ServicoSyncCatalogo } from './servico-sync-catalogo';
import type { FonteCatalogoSync } from './tipos';

function resumo(id: string, nome?: string): ProdutoResumo {
  return {
    produtoCanonicoId: id,
    ...(nome ? { nomeExibicao: nome } : {}),
    unidadeBase: 'kg',
  };
}

/** Stub que captura os ids recebidos e devolve só os que "existem". */
class FonteStub implements FonteCatalogoSync {
  pedidos?: readonly string[];
  constructor(private readonly existentes: ProdutoResumo[]) {}
  resumosProdutos(ids: readonly string[]): Promise<ProdutoResumo[]> {
    this.pedidos = ids;
    const pedidos = new Set(ids);
    // Fora de ordem de propósito: espelha o `in (...)` do Postgres, que não
    // promete ordem nenhuma.
    return Promise.resolve(
      this.existentes.filter((r) => pedidos.has(r.produtoCanonicoId)).reverse(),
    );
  }
}

describe('ServicoSyncCatalogo (C4.5)', () => {
  it('desce os resumos dos ids pedidos, na ORDEM pedida', async () => {
    const fonte = new FonteStub([resumo('p-1', 'Arroz'), resumo('p-2', 'Leite')]);
    const r = await new ServicoSyncCatalogo(fonte).produtos({ produtoCanonicoIds: ['p-1', 'p-2'] });

    expect(r.produtos.map((p) => p.produtoCanonicoId)).toEqual(['p-1', 'p-2']);
    expect(r.produtos[0]?.nomeExibicao).toBe('Arroz');
  });

  it('id sem produto no catálogo apenas não volta (não é erro)', async () => {
    const fonte = new FonteStub([resumo('p-1', 'Arroz')]);
    const r = await new ServicoSyncCatalogo(fonte).produtos({
      produtoCanonicoIds: ['p-1', 'sumiu'],
    });

    expect(r.produtos.map((p) => p.produtoCanonicoId)).toEqual(['p-1']);
  });

  it('deduplica ANTES do teto — repetição não gasta a cota do lote', async () => {
    const fonte = new FonteStub([resumo('p-1'), resumo('p-2')]);
    const r = await new ServicoSyncCatalogo(fonte, 2).produtos({
      produtoCanonicoIds: ['p-1', 'p-1', 'p-2'],
    });

    expect(fonte.pedidos).toEqual(['p-1', 'p-2']);
    expect(r.produtos).toHaveLength(2);
  });

  it('corta no teto do servidor pelo COMEÇO da fila do cliente', async () => {
    const fonte = new FonteStub([resumo('p-1'), resumo('p-2'), resumo('p-3')]);
    const r = await new ServicoSyncCatalogo(fonte, 2).produtos({
      produtoCanonicoIds: ['p-1', 'p-2', 'p-3'],
    });

    expect(r.produtos.map((p) => p.produtoCanonicoId)).toEqual(['p-1', 'p-2']);
  });

  it('lote vazio não consulta o banco', async () => {
    const fonte = new FonteStub([resumo('p-1')]);
    const r = await new ServicoSyncCatalogo(fonte).produtos({ produtoCanonicoIds: [] });

    expect(r.produtos).toEqual([]);
    expect(fonte.pedidos).toBeUndefined();
  });
});
