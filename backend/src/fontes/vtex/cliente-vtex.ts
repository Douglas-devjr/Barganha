/**
 * Cliente do catálogo público VTEX (C11.5 automático / C12.4).
 *
 * Toda loja VTEX expõe `GET /api/catalog_system/pub/products/search` com
 * `fq=alternateIds_Ean:<ean>` — endpoint público e documentado pela plataforma.
 * POLIDEZ COMO POLÍTICA (mitigação do risco de bloqueio/ToS):
 *  • roda SÓ no servidor/job (nunca no app), em lote pequeno e com pausa;
 *  • User-Agent honesto identificando o Barganha;
 *  • timeout curto e falha suave — uma rede fora do ar não derruba o lote;
 *  • nenhum dado pessoal em nenhuma direção (catálogo → catálogo).
 */

import type { FonteCatalogo, ProdutoCatalogo, RedeVtex } from './tipos';

const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Barganha/1.0 (enriquecimento de catalogo; +https://github.com/Douglas-devjr)';

/** Forma mínima da resposta do search VTEX (só o que consumimos). */
interface ProdutoVtex {
  productName?: string;
  brand?: string;
  categories?: string[];
  items?: Array<{
    ean?: string;
    images?: Array<{ imageUrl?: string }>;
    sellers?: Array<{
      commertialOffer?: { Price?: number; IsAvailable?: boolean };
    }>;
  }>;
}

/** Último segmento não vazio de "/Mercearia/Café/" → "Café". */
function categoriaMaisEspecifica(categorias: string[] | undefined): string | undefined {
  const primeira = categorias?.[0];
  if (!primeira) return undefined;
  const segmentos = primeira.split('/').filter((s) => s.trim().length > 0);
  return segmentos.at(-1)?.trim() || undefined;
}

/**
 * Resposta do search → `ProdutoCatalogo`. Puro (testável com fixture). Escolhe
 * o SKU cujo EAN bate com o consultado (o `fq` pode devolver o produto inteiro
 * com variações); sem SKU batendo, usa o primeiro.
 */
export function parseRespostaVtex(corpo: unknown, ean: string): ProdutoCatalogo | undefined {
  if (!Array.isArray(corpo) || corpo.length === 0) return undefined;
  const produto = corpo[0] as ProdutoVtex;
  const nome = (produto.productName ?? '').trim();
  if (!nome) return undefined;

  const sku = produto.items?.find((i) => i.ean === ean) ?? produto.items?.[0];
  const oferta = sku?.sellers?.[0]?.commertialOffer;
  const preco = oferta?.Price;
  const imagem = sku?.images?.[0]?.imageUrl;
  const categoria = categoriaMaisEspecifica(produto.categories);
  const marca = produto.brand?.trim();

  return {
    ean,
    nome,
    ...(marca ? { marca } : {}),
    ...(categoria ? { categoria } : {}),
    ...(imagem ? { imagemUrl: imagem } : {}),
    ...(typeof preco === 'number' && preco > 0 ? { precoAnunciado: preco } : {}),
    ...(oferta?.IsAvailable != null ? { disponivel: oferta.IsAvailable } : {}),
  };
}

export class ClienteVtex implements FonteCatalogo {
  async buscarPorEan(rede: RedeVtex, ean: string): Promise<ProdutoCatalogo | undefined> {
    const url =
      `https://${rede.dominio}/api/catalog_system/pub/products/search` +
      `?fq=alternateIds_Ean:${encodeURIComponent(ean)}`;

    const aborto = new AbortController();
    const timer = setTimeout(() => aborto.abort(), TIMEOUT_MS);
    try {
      const resposta = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: aborto.signal,
      });
      // 200 = completo; 206 = parcial (paginação do VTEX) — ambos trazem corpo.
      if (resposta.status !== 200 && resposta.status !== 206) {
        throw new Error(`Catálogo ${rede.id} respondeu HTTP ${resposta.status}.`);
      }
      return parseRespostaVtex(await resposta.json(), ean);
    } finally {
      clearTimeout(timer);
    }
  }
}
