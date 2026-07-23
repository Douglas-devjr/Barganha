import { extrairObservacoesAnonimas } from '@barganha/shared';
import { describe, expect, it } from 'vitest';

import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { resolverFallback, type LocalGeo } from './escopos';
import { PipelineEstatistica } from './pipeline';
import type { FonteObservacoes, ObservacaoParaAgregacao } from './tipos';

const REF = new Date('2026-06-28T00:00:00.000Z');
const LOJA_A = '12345678000199';
const LOJA_B = '99999999000100';

function obs(
  preco: number,
  lojaCnpj: string,
  dias = 1,
  emPromocao = false,
): ObservacaoParaAgregacao {
  return {
    produtoCanonicoId: 'p-leite',
    unidadeBase: 'L',
    lojaCnpj,
    municipio: 'Rio de Janeiro',
    uf: 'RJ',
    precoNormalizado: preco,
    emPromocao,
    observadoEm: new Date(REF.getTime() - dias * 86_400_000).toISOString(),
  };
}

function fonteCom(observacoes: ObservacaoParaAgregacao[]): FonteObservacoes {
  return {
    listarProdutosComObservacoes: () => Promise.resolve(['p-leite']),
    // Honra a janela como o adaptador real faz (recorte no SQL).
    observacoesDoProduto: (_id, desde) =>
      Promise.resolve(desde ? observacoes.filter((o) => o.observadoEm >= desde) : observacoes),
  };
}

describe('PipelineEstatistica (C3.1)', () => {
  it('gera uma linha por escopo (loja, município, UF) a partir das observações', async () => {
    const fonte = fonteCom([
      obs(6.0, LOJA_A),
      obs(6.5, LOJA_A),
      obs(7.0, LOJA_B),
      obs(7.2, LOJA_B),
    ]);
    const repo = new RepositorioMemoria();
    const pipeline = new PipelineEstatistica(fonte, repo, { referencia: REF });

    const n = await pipeline.recalcularProduto('p-leite');
    expect(n).toBe(4); // 2 lojas + 1 município + 1 UF

    const linhas = repo.estatisticasDoProduto('p-leite');
    const escopos = linhas.map((l) => `${l.escopo}:${l.escopoId}`).sort();
    expect(escopos).toEqual([
      `loja:${LOJA_A}`,
      `loja:${LOJA_B}`,
      'municipio:RJ:RIO DE JANEIRO',
      'uf:RJ',
    ]);

    // O nível UF agrega as 4 observações; a loja A, só as 2 dela.
    const uf = linhas.find((l) => l.escopo === 'uf')!;
    const lojaA = linhas.find((l) => l.escopo === 'loja' && l.escopoId === LOJA_A)!;
    expect(uf.nObservacoes).toBe(4);
    expect(lojaA.nObservacoes).toBe(2);
  });

  it('alimenta o fallback hierárquico (C3.3) de ponta a ponta', async () => {
    // Loja A com poucas observações; UF com bastante.
    const fonte = fonteCom([
      obs(6.0, LOJA_A),
      obs(6.5, LOJA_B),
      obs(6.6, LOJA_B),
      obs(6.7, LOJA_B),
      obs(6.8, LOJA_B),
    ]);
    const repo = new RepositorioMemoria();
    await new PipelineEstatistica(fonte, repo, { referencia: REF }).recalcularProduto('p-leite');

    const local: LocalGeo = { lojaCnpj: LOJA_A, municipio: 'Rio de Janeiro', uf: 'RJ' };
    const candidatos = await repo.candidatosFallback('p-leite');
    const resolvido = resolverFallback(candidatos, local);

    // A loja A só tem 1 observação (< mínimo) → sobe para município/UF.
    expect(resolvido?.escopoResolvido).not.toBe('loja');
    expect(resolvido?.estatistica.nObservacoes).toBeGreaterThanOrEqual(3);
  });

  it('recalcularTodos percorre os produtos com observação', async () => {
    const repo = new RepositorioMemoria();
    const fonte = fonteCom([obs(6.0, LOJA_A), obs(6.4, LOJA_A), obs(6.8, LOJA_A)]);
    const total = await new PipelineEstatistica(fonte, repo, { referencia: REF }).recalcularTodos();
    expect(total).toBeGreaterThan(0);
  });
});

describe('FonteObservacoes incremental por inserção (F1)', () => {
  it('cupom de emissão ANTIGA enviado agora ainda dispara recálculo', async () => {
    const repo = new RepositorioMemoria();
    const { cupomId } = await repo.criarOuObterPorChave({
      usuarioId: 'u',
      chaveAcesso: 'k',
      uf: 'RJ',
      qrPayload: 'q',
      capturadoEm: REF.toISOString(),
    });
    // Observação com emissão antiga (jan), mas inserida agora (offline-first).
    const observacoes = extrairObservacoesAnonimas({
      loja: { cnpj: '12345678000199', municipio: 'Rio de Janeiro', uf: 'RJ' },
      observadoEm: '2026-01-01T12:00:00.000Z',
      itens: [
        { produtoCanonicoId: 'p-leite', precoNormalizado: 5, unidadeBase: 'L', emPromocao: false },
      ],
      usuarioId: 'u',
      cupomId,
    });
    await repo.marcarProcessado(cupomId, {
      loja: {
        cnpj: '12345678000199',
        razaoSocial: 'X',
        endereco: 'Y',
        municipio: 'Rio de Janeiro',
        uf: 'RJ',
      },
      emitidoEm: '2026-01-01T12:00:00.000Z',
      uf: 'RJ',
      itensPrivados: [],
      observacoes,
    });

    // Cursor em junho: por emissão (jan) o produto seria pulado; por inserção, não.
    const ids = await repo.listarProdutosComObservacoes('2026-06-01T00:00:00.000Z');
    expect(ids).toContain('p-leite');
  });
});

describe('PipelineEstatistica — janela aplicada NA CONSULTA (correção de truncagem)', () => {
  it('pede à fonte só o que está dentro da janela do decaimento', async () => {
    // O bug: `observacoesDoProduto` trazia o histórico INTEIRO do produto. O
    // PostgREST tem teto de linhas (`max_rows`, 1000) e o aplica em silêncio,
    // então num produto popular a mediana passava a ser calculada sobre uma
    // fatia arbitrária — enviesada para as observações mais ANTIGAS (ordem do
    // heap), justamente as que o decaimento descartaria. Agora o recorte de
    // 180 dias vai no SQL, e a leitura vem ordenada por observado_em DESC.
    let janelaPedida: string | undefined;
    const fonte: FonteObservacoes = {
      listarProdutosComObservacoes: () => Promise.resolve(['p-leite']),
      observacoesDoProduto: (_id, desde) => {
        janelaPedida = desde;
        return Promise.resolve([obs(6, LOJA_A)]);
      },
    };

    await new PipelineEstatistica(fonte, new RepositorioMemoria(), {
      referencia: REF,
    }).recalcularProduto('p-leite');

    expect(janelaPedida).toBeDefined();
    const esperado = new Date(REF.getTime() - 180 * 86_400_000).toISOString();
    expect(janelaPedida).toBe(esperado);
  });

  it('respeita um maxIdadeDias customizado', async () => {
    let janelaPedida: string | undefined;
    const fonte: FonteObservacoes = {
      listarProdutosComObservacoes: () => Promise.resolve(['p-leite']),
      observacoesDoProduto: (_id, desde) => {
        janelaPedida = desde;
        return Promise.resolve([obs(6, LOJA_A)]);
      },
    };

    await new PipelineEstatistica(fonte, new RepositorioMemoria(), {
      referencia: REF,
      agregacao: { maxIdadeDias: 30 },
    }).recalcularProduto('p-leite');

    expect(janelaPedida).toBe(new Date(REF.getTime() - 30 * 86_400_000).toISOString());
  });

  it('desmarca a pendência só dos produtos que recalculou', async () => {
    const limpos: string[] = [];
    const fonte: FonteObservacoes = {
      listarProdutosComObservacoes: () => Promise.resolve(['p-leite', 'p-arroz']),
      observacoesDoProduto: () => Promise.resolve([obs(6, LOJA_A)]),
      limparPendenciaRecalculo: (ids) => {
        limpos.push(...ids);
        return Promise.resolve();
      },
    };

    await new PipelineEstatistica(fonte, new RepositorioMemoria(), {
      referencia: REF,
    }).recalcularTodos('2026-06-01T00:00:00.000Z');

    expect(limpos).toEqual(['p-leite', 'p-arroz']);
  });
});
