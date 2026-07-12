/**
 * C11.5 automático — comportamento do lote: primeira rede que conhece o EAN
 * resolve, circuit breaker desliga rede com falhas seguidas, teto respeitado,
 * e o preço anunciado NUNCA vai para o gate de enriquecimento.
 */

import { describe, expect, it } from 'vitest';

import type {
  AlvoEnriquecimento,
  EnriquecimentoProduto,
  RepositorioCuradoria,
} from '../curadoria/tipos';

import { ServicoEnriquecimentoCatalogo } from './servico-enriquecimento-catalogo';
import type { FonteCatalogo, ProdutoCatalogo, RedeVtex } from './vtex/tipos';

const REDE_A: RedeVtex = { id: 'a', nome: 'Rede A', dominio: 'a.exemplo' };
const REDE_B: RedeVtex = { id: 'b', nome: 'Rede B', dominio: 'b.exemplo' };

function repoFake(alvos: AlvoEnriquecimento[]): {
  repo: RepositorioCuradoria;
  gravados: EnriquecimentoProduto[];
} {
  const gravados: EnriquecimentoProduto[] = [];
  return {
    gravados,
    repo: {
      listarProdutosParaEnriquecer: (limite) => Promise.resolve(alvos.slice(0, limite)),
      enriquecerProduto: (dados) => {
        gravados.push(dados);
        return Promise.resolve(dados.produtoCanonicoId);
      },
    },
  };
}

const alvo = (n: number): AlvoEnriquecimento => ({
  produtoCanonicoId: `p${n}`,
  ean: `789000000000${n}`,
});

const produto = (ean: string): ProdutoCatalogo => ({
  ean,
  nome: 'Café 500g',
  marca: 'Pilão',
  categoria: 'Café',
  imagemUrl: 'https://img/x.jpg',
  precoAnunciado: 18.49,
});

const semPausa = { pausaMs: 0, dormir: () => Promise.resolve() };

describe('ServicoEnriquecimentoCatalogo (C11.5)', () => {
  it('enriquece pela primeira rede que conhece o EAN — e o preço NÃO vai ao gate', async () => {
    const { repo, gravados } = repoFake([alvo(1)]);
    const consultas: string[] = [];
    const fonte: FonteCatalogo = {
      buscarPorEan: (rede, ean) => {
        consultas.push(rede.id);
        return Promise.resolve(rede.id === 'a' ? produto(ean) : undefined);
      },
    };

    const r = await new ServicoEnriquecimentoCatalogo(
      repo,
      fonte,
      [REDE_A, REDE_B],
      semPausa,
    ).executar();

    expect(r).toMatchObject({ examinados: 1, enriquecidos: 1, semCatalogo: 0, falhas: 0 });
    expect(consultas).toEqual(['a']); // B nem foi consultada.
    expect(gravados[0]).toEqual({
      produtoCanonicoId: 'p1',
      nomeExibicao: 'Café 500g',
      marca: 'Pilão',
      categoria: 'Café',
      imagemUrl: 'https://img/x.jpg',
      // sem `precoAnunciado`: preço de e-commerce jamais entra pelo gate.
    });
  });

  it('circuit breaker: rede com 3 falhas seguidas sai do resto do lote', async () => {
    const { repo } = repoFake([alvo(1), alvo(2), alvo(3), alvo(4)]);
    const porRede = new Map<string, number>();
    const fonte: FonteCatalogo = {
      buscarPorEan: (rede) => {
        porRede.set(rede.id, (porRede.get(rede.id) ?? 0) + 1);
        if (rede.id === 'a') return Promise.reject(new Error('rede fora'));
        return Promise.resolve(undefined);
      },
    };

    const r = await new ServicoEnriquecimentoCatalogo(
      repo,
      fonte,
      [REDE_A, REDE_B],
      semPausa,
    ).executar();

    expect(porRede.get('a')).toBe(3); // desligada após a 3ª falha seguida.
    expect(porRede.get('b')).toBe(4); // B seguiu atendendo o lote inteiro.
    expect(r).toMatchObject({ examinados: 4, enriquecidos: 0, semCatalogo: 4, falhas: 3 });
  });

  it('respeita o teto por execução e conta sem_catalogo', async () => {
    const { repo } = repoFake([alvo(1), alvo(2), alvo(3)]);
    const fonte: FonteCatalogo = { buscarPorEan: () => Promise.resolve(undefined) };

    const r = await new ServicoEnriquecimentoCatalogo(repo, fonte, [REDE_A], {
      ...semPausa,
      teto: 2,
    }).executar();

    expect(r).toMatchObject({ examinados: 2, semCatalogo: 2 });
  });

  it('sem redes configuradas → no-op (feature desligada)', async () => {
    const { repo, gravados } = repoFake([alvo(1)]);
    const fonte: FonteCatalogo = { buscarPorEan: () => Promise.reject(new Error('não chamar')) };

    const r = await new ServicoEnriquecimentoCatalogo(repo, fonte, [], semPausa).executar();

    expect(r).toEqual({ examinados: 0, enriquecidos: 0, semCatalogo: 0, falhas: 0 });
    expect(gravados).toHaveLength(0);
  });
});
