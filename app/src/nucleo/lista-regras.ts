/**
 * C12.1 — regra PURA de de-duplicação da lista de compras (sem I/O, testável). O
 * lado que fala com o SQLite vive em `dados/repositorio-lista.ts`.
 *
 * A CHAVE decide se duas linhas são "o mesmo item": um produto identificado usa
 * o próprio id canônico (não há como duas linhas terem o mesmo produto); um item
 * "a escolher no mercado" (sem marca ainda — nunca "genérico" na UI, ver
 * `FolhaAdicionarItem`) usa a descrição normalizada, para "sabão em pó" digitado
 * duas vezes não virar duas linhas pendentes.
 */

import { normalizarDescricao } from '@barganha/shared';

/** Prefixo da chave de um item pendente — não colide com um id canônico real. */
const PREFIXO_PENDENTE = 'generico:';

/**
 * Chave de de-duplicação de uma linha da lista: o id canônico quando o produto
 * já foi identificado, senão a descrição normalizada do item pendente.
 */
export function calcularChaveItemLista(produtoCanonicoId: string | null, nome: string): string {
  return produtoCanonicoId ?? `${PREFIXO_PENDENTE}${normalizarDescricao(nome)}`;
}
