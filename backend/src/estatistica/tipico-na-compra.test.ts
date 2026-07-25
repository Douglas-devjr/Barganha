import type { EscopoGeo, PrecoEstatistica } from '@barganha/shared';
import { describe, expect, it } from 'vitest';

import type { ItemCupomNovo } from '../anonimizacao/anonimizador';

import type { LocalGeo } from './escopos';
import { comTipicoNaCompra, type FonteTipico } from './tipico-na-compra';

const LOCAL: LocalGeo = { lojaCnpj: '12345678000199', municipio: 'Rio de Janeiro', uf: 'RJ' };

function estat(escopo: EscopoGeo, escopoId: string, mediana: number, n: number): PrecoEstatistica {
  return {
    produtoCanonicoId: 'leite',
    escopo,
    escopoId,
    unidadeBase: 'L',
    mediana,
    nObservacoes: n,
    atualizadoEm: '2026-07-20T00:00:00.000Z',
  };
}

function item(parcial: Partial<ItemCupomNovo> = {}): ItemCupomNovo {
  return {
    produtoCanonicoId: 'leite',
    descricaoOriginal: 'LEITE INTEGRAL 1L',
    quantidade: 1,
    unidade: 'UN',
    valorUnitario: 5.49,
    valorTotal: 5.49,
    ...parcial,
  };
}

/** Fonte que devolve sempre as mesmas linhas, e conta as consultas. */
function fonte(linhas: PrecoEstatistica[]): FonteTipico & { chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    candidatosFallback(produtoCanonicoId) {
      chamadas.push(produtoCanonicoId);
      return Promise.resolve(linhas);
    },
  };
}

describe('comTipicoNaCompra', () => {
  it('congela a mediana do município, com escopo e tamanho da base', async () => {
    const [resultado] = await comTipicoNaCompra(
      [item()],
      LOCAL,
      fonte([estat('municipio', 'RJ:RIO DE JANEIRO', 6.9, 12)]),
    );

    expect(resultado?.tipicoNaCompra).toEqual({
      mediana: 6.9,
      unidadeBase: 'L',
      escopo: 'municipio',
      nObservacoes: 12,
    });
  });

  it('IGNORA o nível loja mesmo sendo o mais específico', async () => {
    // Comparar o que o usuário pagou com a mediana da própria loja tende a zero
    // (ele é parte dessa mediana) e responde "peguei promoção aqui?" — não é a
    // pergunta do app. A base tem que subir para o município.
    const [resultado] = await comTipicoNaCompra(
      [item()],
      LOCAL,
      fonte([
        estat('loja', '12345678000199', 5.5, 40),
        estat('municipio', 'RJ:RIO DE JANEIRO', 6.9, 12),
      ]),
    );

    expect(resultado?.tipicoNaCompra?.escopo).toBe('municipio');
    expect(resultado?.tipicoNaCompra?.mediana).toBe(6.9);
  });

  it('sobe para a UF quando o município não tem base suficiente', async () => {
    const [resultado] = await comTipicoNaCompra(
      [item()],
      LOCAL,
      fonte([estat('municipio', 'RJ:RIO DE JANEIRO', 6.9, 1), estat('uf', 'RJ', 7.2, 80)]),
    );

    expect(resultado?.tipicoNaCompra?.escopo).toBe('uf');
    expect(resultado?.tipicoNaCompra?.mediana).toBe(7.2);
  });

  it('não inventa nada sem base na região — item passa intacto', async () => {
    const entrada = item();
    const [resultado] = await comTipicoNaCompra([entrada], LOCAL, fonte([]));

    expect(resultado?.tipicoNaCompra).toBeUndefined();
    expect(resultado).toEqual(entrada);
  });

  it('ignora item sem produto canônico e não o consulta', async () => {
    const f = fonte([estat('municipio', 'RJ:RIO DE JANEIRO', 6.9, 12)]);
    const semCanonico = item({ produtoCanonicoId: undefined });

    const [resultado] = await comTipicoNaCompra([semCanonico], LOCAL, f);

    expect(resultado?.tipicoNaCompra).toBeUndefined();
    expect(f.chamadas).toEqual([]);
  });

  it('consulta uma vez por produto DISTINTO, não por linha do cupom', async () => {
    const f = fonte([estat('municipio', 'RJ:RIO DE JANEIRO', 6.9, 12)]);

    await comTipicoNaCompra([item(), item(), item({ produtoCanonicoId: 'cafe' })], LOCAL, f);

    expect(f.chamadas).toEqual(['leite', 'cafe']);
  });

  it('não muta a entrada', async () => {
    const entrada = [item()];
    await comTipicoNaCompra(entrada, LOCAL, fonte([estat('municipio', 'RJ:RJ', 6.9, 12)]));

    expect(entrada[0]?.tipicoNaCompra).toBeUndefined();
  });
});
