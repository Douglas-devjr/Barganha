import { describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import type { DadosNotaProcessada } from '../persistencia/tipos';
import { republicarPool } from './republicar-pool';

const LOJA: DadosNotaProcessada['loja'] = {
  cnpj: '12345678000199',
  razaoSocial: 'SUPERMERCADO MARACANA LTDA',
  endereco: 'Av. Atlantica, 500 - Rio de Janeiro/RJ',
  municipio: 'Rio de Janeiro',
  uf: 'RJ',
};

/** Cupom `processado` ANTES do casamento sem EAN: itens sem canônico, pool vazio. */
async function semearCupomSemPool(repo: RepositorioMemoria, usuarioId: string): Promise<string> {
  const { cupomId } = await repo.criarOuObterPorChave({
    usuarioId,
    chaveAcesso: '33260612345678000199650010000000011000000016',
    uf: 'RJ',
    qrPayload: 'qr-cru',
    capturadoEm: '2026-06-20T22:00:00.000Z',
  });
  await repo.marcarProcessado(cupomId, {
    loja: LOJA,
    emitidoEm: '2026-06-20T21:30:00.000Z',
    uf: 'RJ',
    itensPrivados: [
      {
        descricaoOriginal: 'ARROZ CARRETEIRO 1kg LF T1',
        quantidade: 1,
        unidade: 'UN',
        valorUnitario: 3.79,
        valorTotal: 3.79,
      },
      {
        descricaoOriginal: 'BISTECA SUINA SADIA kg CONG',
        // Código interno da loja preservado do parser (docs/03) — o backfill
        // precisa reconstruir a NotaEstruturada SEM perder este dado, senão um
        // cupom antigo silenciosamente esquece o que já tinha sido persistido.
        codigoLoja: '881245',
        quantidade: 0.91,
        unidade: 'KG',
        valorUnitario: 14.98,
        valorTotal: 13.63,
      },
    ],
    observacoes: [],
  });
  return cupomId;
}

describe('republicarPool (backfill do pool)', () => {
  it('republica cupom processado sem canônicos: pool, itens e recálculo', async () => {
    const repo = new RepositorioMemoria();
    const usuarioId = await repo.criarAnonimo();
    const cupomId = await semearCupomSemPool(repo, usuarioId);

    const recalculados: string[] = [];
    const resumo = await republicarPool(repo, new Anonimizador(repo), async (id) => {
      recalculados.push(id);
    });

    expect(resumo).toMatchObject({
      cuponsExaminados: 1,
      cuponsRepublicados: 1,
      observacoesPublicadas: 2,
      produtosRecalculados: 2,
    });
    // Pool ganhou as observações anônimas (normalizadas, casadas por descrição).
    const pool = repo.observacoesDoPool();
    expect(pool).toHaveLength(2);
    expect(pool.map((o) => o.unidadeBase).sort()).toEqual(['kg', 'un']);
    expect(pool.every((o) => o.lojaCnpj === LOJA.cnpj && o.uf === 'RJ')).toBe(true);
    // Itens privados foram regravados COM o canônico.
    expect(repo.itensDoCupom(cupomId).every((i) => i.produtoCanonicoId)).toBe(true);
    // codigoLoja sobrevive à reconstrução da nota a partir do lado privado —
    // sem isso, o backfill apagaria silenciosamente um dado já persistido.
    const bisteca = repo
      .itensDoCupom(cupomId)
      .find((i) => i.descricaoOriginal === 'BISTECA SUINA SADIA kg CONG');
    expect(bisteca?.codigoLoja).toBe('881245');
    expect(repo.statusDoCupom(cupomId)).toBe('processado');
    // Recalculou exatamente os produtos que entraram no pool.
    expect(new Set(recalculados)).toEqual(new Set(pool.map((o) => o.produtoCanonicoId)));
  });

  it('é idempotente: a segunda passada não duplica o pool', async () => {
    const repo = new RepositorioMemoria();
    const usuarioId = await repo.criarAnonimo();
    await semearCupomSemPool(repo, usuarioId);
    const anonimizador = new Anonimizador(repo);

    await republicarPool(repo, anonimizador, async () => {});
    const segunda = await republicarPool(repo, anonimizador, async () => {});

    expect(segunda.cuponsRepublicados).toBe(0);
    expect(repo.observacoesDoPool()).toHaveLength(2);
  });

  it('pula cupom em que algum item já tem canônico (pode já ter publicado)', async () => {
    const repo = new RepositorioMemoria();
    const usuarioId = await repo.criarAnonimo();
    const { cupomId } = await repo.criarOuObterPorChave({
      usuarioId,
      uf: 'RJ',
      qrPayload: 'qr-cru-2',
      capturadoEm: '2026-06-21T10:00:00.000Z',
    });
    await repo.marcarProcessado(cupomId, {
      loja: LOJA,
      emitidoEm: '2026-06-21T09:30:00.000Z',
      uf: 'RJ',
      itensPrivados: [
        {
          produtoCanonicoId: 'canon-ja-publicado',
          descricaoOriginal: 'CAFE TORRADO 500G',
          ean: '7890000000017',
          quantidade: 1,
          unidade: 'UN',
          valorUnitario: 16.9,
          valorTotal: 16.9,
        },
      ],
      observacoes: [],
    });

    const resumo = await republicarPool(repo, new Anonimizador(repo), async () => {});

    expect(resumo.cuponsRepublicados).toBe(0);
    expect(repo.observacoesDoPool()).toHaveLength(0);
  });
});
