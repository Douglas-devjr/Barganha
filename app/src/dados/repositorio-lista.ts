/**
 * C12.1 — Lista de compras LOCAL. A lista vive só no aparelho (não sincroniza):
 * é uma preferência do usuário, não histórico nem pool. A comparação por loja
 * ("onde a cesta sai mais barata") envia apenas os ids canônicos ao endpoint
 * anônimo `/consulta/lista` — nada identifica o usuário (docs/04).
 *
 * `marcado` é o "já está no carrinho" da aba Lista (handoff 3a): estado da ida
 * ao mercado, guardado porque a compra atravessa fechamentos do app.
 */

import { getBd } from './bd';

export interface ItemLista {
  produtoCanonicoId: string;
  nome: string;
  /** Multiplicador da unidade-base do produto (padrão 1). */
  quantidade: number;
  /** Caixa de seleção da aba Lista — "já peguei este". */
  marcado: boolean;
  criadoEm: string;
}

interface LinhaLista {
  produto_canonico_id: string;
  nome: string;
  quantidade: number;
  marcado: number;
  criado_em: string;
}

function mapear(l: LinhaLista): ItemLista {
  return {
    produtoCanonicoId: l.produto_canonico_id,
    nome: l.nome,
    quantidade: l.quantidade,
    marcado: l.marcado === 1,
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
    `INSERT INTO lista_compras (produto_canonico_id, nome, quantidade, marcado, criado_em)
     VALUES (?, ?, 1, 0, ?)
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

/** Marca/desmarca "já está no carrinho". */
export async function definirMarcado(produtoCanonicoId: string, marcado: boolean): Promise<void> {
  await getBd().runAsync(`UPDATE lista_compras SET marcado = ? WHERE produto_canonico_id = ?`, [
    marcado ? 1 : 0,
    produtoCanonicoId,
  ]);
}

/** Desmarca tudo — o "recomeçar a compra" depois de passar no caixa. */
export async function desmarcarTodos(): Promise<void> {
  await getBd().runAsync(`UPDATE lista_compras SET marcado = 0`);
}

/**
 * Ids da lista para o recorte do delta sync (C7.7). Desde o C7.6 a lista pode
 * conter produto vindo do catálogo REGIONAL, que o usuário nunca comprou: sem
 * entrar aqui, ele ficaria fora do sync e sem típico offline — justo o item que
 * a pessoa acabou de dizer que quer comprar.
 */
export async function listarProdutoCanonicoIds(): Promise<string[]> {
  const linhas = await getBd().getAllAsync<{ produto_canonico_id: string }>(
    `SELECT produto_canonico_id FROM lista_compras`,
  );
  return linhas.map((l) => l.produto_canonico_id);
}

/** Se o produto já está na lista (estado do botão "adicionar"). */
export async function contem(produtoCanonicoId: string): Promise<boolean> {
  const linha = await getBd().getFirstAsync<{ um: number }>(
    `SELECT 1 AS um FROM lista_compras WHERE produto_canonico_id = ? LIMIT 1`,
    [produtoCanonicoId],
  );
  return linha != null;
}
