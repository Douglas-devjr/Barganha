/**
 * C12.1 — Lista de compras LOCAL. A lista vive só no aparelho (não sincroniza):
 * é uma preferência do usuário, não histórico nem pool. A comparação por loja
 * ("onde a cesta sai mais barata") envia apenas os ids canônicos ao endpoint
 * anônimo `/consulta/lista` — nada identifica o usuário (docs/04).
 */

import { getBd } from './bd';

export interface ItemLista {
  produtoCanonicoId: string;
  nome: string;
  /** Multiplicador da unidade-base do produto (padrão 1). */
  quantidade: number;
  criadoEm: string;
}

interface LinhaLista {
  produto_canonico_id: string;
  nome: string;
  quantidade: number;
  criado_em: string;
}

function mapear(l: LinhaLista): ItemLista {
  return {
    produtoCanonicoId: l.produto_canonico_id,
    nome: l.nome,
    quantidade: l.quantidade,
    criadoEm: l.criado_em,
  };
}

export async function listar(): Promise<ItemLista[]> {
  const linhas = await getBd().getAllAsync<LinhaLista>(
    `SELECT * FROM lista_compras ORDER BY criado_em ASC`,
  );
  return linhas.map(mapear);
}

/** Adiciona (ou re-adiciona) um produto; repetir não duplica nem zera a quantidade. */
export async function adicionar(produtoCanonicoId: string, nome: string): Promise<void> {
  await getBd().runAsync(
    `INSERT INTO lista_compras (produto_canonico_id, nome, quantidade, criado_em)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (produto_canonico_id) DO UPDATE SET nome = excluded.nome`,
    [produtoCanonicoId, nome, new Date().toISOString()],
  );
}

export async function remover(produtoCanonicoId: string): Promise<void> {
  await getBd().runAsync(`DELETE FROM lista_compras WHERE produto_canonico_id = ?`, [
    produtoCanonicoId,
  ]);
}

/** Ajusta a quantidade (mínimo 1 — para tirar da lista, use `remover`). */
export async function definirQuantidade(
  produtoCanonicoId: string,
  quantidade: number,
): Promise<void> {
  await getBd().runAsync(`UPDATE lista_compras SET quantidade = ? WHERE produto_canonico_id = ?`, [
    Math.max(1, quantidade),
    produtoCanonicoId,
  ]);
}

/** Se o produto já está na lista (estado do botão "adicionar"). */
export async function contem(produtoCanonicoId: string): Promise<boolean> {
  const linha = await getBd().getFirstAsync<{ um: number }>(
    `SELECT 1 AS um FROM lista_compras WHERE produto_canonico_id = ? LIMIT 1`,
    [produtoCanonicoId],
  );
  return linha != null;
}
