/** C11.5 — Parse da resposta do catálogo público VTEX (puro, com fixture). */

import { describe, expect, it } from 'vitest';

import { parseRespostaVtex } from './cliente-vtex';

const EAN = '7891234567890';

/** Resposta real (recortada) do `catalog_system/pub/products/search`. */
const RESPOSTA = [
  {
    productName: 'Café Torrado e Moído Tradicional 500g',
    brand: 'Pilão',
    categories: ['/Mercearia/Cafés, Chás e Achocolatados/Café/'],
    items: [
      {
        ean: '0000000000000', // variação que NÃO é a consultada
        images: [{ imageUrl: 'https://img.exemplo/errada.jpg' }],
        sellers: [{ commertialOffer: { Price: 99.9, IsAvailable: false } }],
      },
      {
        ean: EAN,
        images: [{ imageUrl: 'https://img.exemplo/cafe.jpg' }],
        sellers: [{ commertialOffer: { Price: 18.49, IsAvailable: true } }],
      },
    ],
  },
];

describe('parseRespostaVtex (C11.5)', () => {
  it('extrai nome, marca, categoria específica, foto e preço do SKU do EAN consultado', () => {
    const p = parseRespostaVtex(RESPOSTA, EAN);
    expect(p).toEqual({
      ean: EAN,
      nome: 'Café Torrado e Moído Tradicional 500g',
      marca: 'Pilão',
      categoria: 'Café',
      imagemUrl: 'https://img.exemplo/cafe.jpg',
      precoAnunciado: 18.49,
      disponivel: true,
    });
  });

  it('rede que não vende o produto (array vazio) → undefined', () => {
    expect(parseRespostaVtex([], EAN)).toBeUndefined();
  });

  it('resposta sem nome utilizável ou fora do formato → undefined (falha suave)', () => {
    expect(parseRespostaVtex([{ productName: '  ' }], EAN)).toBeUndefined();
    expect(parseRespostaVtex({ erro: 'x' }, EAN)).toBeUndefined();
  });

  it('sem SKU batendo o EAN, usa o primeiro (produto de variação única)', () => {
    const p = parseRespostaVtex(
      [
        {
          productName: 'Arroz Branco 5kg',
          items: [{ sellers: [{ commertialOffer: { Price: 24.9, IsAvailable: true } }] }],
        },
      ],
      EAN,
    );
    expect(p).toMatchObject({ nome: 'Arroz Branco 5kg', precoAnunciado: 24.9 });
    expect(p?.marca).toBeUndefined();
    expect(p?.categoria).toBeUndefined();
  });
});
