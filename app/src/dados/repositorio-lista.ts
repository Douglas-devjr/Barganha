/**
 * C12.1 — Lista de compras LOCAL. A lista vive só no aparelho (não sincroniza):
 * é uma preferência do usuário, não histórico nem pool. A comparação por loja
 * ("onde a cesta sai mais barata") envia apenas os ids canônicos ao endpoint
 * anônimo `/consulta/lista` — nada identifica o usuário (docs/04).
 *
 * `marcado` é o "já está no carrinho" da aba Lista (handoff 3a): estado da ida
 * ao mercado, guardado porque a compra atravessa fechamentos do app.
 *
 * `foraComparacao` é o recorte da tela Comparar mercados — o item continua na
 * lista de compras, só não entra no ranking por loja. São intenções diferentes:
 * "não vou levar isto" (remover) e "quero ver o ranking sem isto" (excluir da
 * comparação). Uma só a lista comanda; a outra tem que persistir, senão sair da
 * tela ressuscita o item.
 */

import { getBd } from './bd';

export interface ItemLista {
  produtoCanonicoId: string;
  nome: string;
  /** Multiplicador da unidade-base do produto (padrão 1). */
  quantidade: number;
  /** Caixa de seleção da aba Lista — "já peguei este". */
  marcado: boolean;
  /** Fora do ranking da tela Comparar mercados (continua na lista). */
  foraComparacao: boolean;
  criadoEm: string;
}

interface LinhaLista {
  produto_canonico_id: string;
  nome: string;
  quantidade: number;
  marcado: number;
  fora_comparacao: number;
  criado_em: string;
}

function mapear(l: LinhaLista): ItemLista {
  return {
    produtoCanonicoId: l.produto_canonico_id,
    nome: l.nome,
    quantidade: l.quantidade,
    marcado: l.marcado === 1,
    foraComparacao: l.fora_comparacao === 1,
    criadoEm: l.criado_em,
  };
}

export async function listar(): Promise<ItemLista[]> {
  const linhas = await getBd().getAllAsync<LinhaLista>(
    `SELECT * FROM lista_compras ORDER BY criado_em ASC`,
  );
  return linhas.map(mapear);
}

/**
 * Adiciona (ou re-adiciona) um produto; repetir não duplica nem zera a
 * quantidade. Re-adicionar traz o item de volta para a comparação: quem busca e
 * adiciona de novo está dizendo que quer este item na conta.
 */
export async function adicionar(produtoCanonicoId: string, nome: string): Promise<void> {
  await getBd().runAsync(
    `INSERT INTO lista_compras
       (produto_canonico_id, nome, quantidade, marcado, fora_comparacao, criado_em)
     VALUES (?, ?, 1, 0, 0, ?)
     ON CONFLICT (produto_canonico_id) DO UPDATE SET
       nome = excluded.nome,
       fora_comparacao = 0`,
    [produtoCanonicoId, nome, new Date().toISOString()],
  );
}

export async function remover(produtoCanonicoId: string): Promise<void> {
  await getBd().runAsync(`DELETE FROM lista_compras WHERE produto_canonico_id = ?`, [
    produtoCanonicoId,
  ]);
}

/**
 * Esvazia a lista de uma vez — o "acabou a compra, começar outra". Sem isto a
 * única saída era remover item por item, o que numa lista de mercado (dezenas
 * de linhas) é trabalho manual demais para uma ação tão comum.
 *
 * Apaga SÓ a lista de compras: o histórico privado de cupons e o
 * `cache_estatistica` não são tocados — a lista é uma intenção de compra, não
 * dado. Os ids simplesmente deixam de entrar no recorte do delta sync (C7.7).
 */
export async function removerTodos(): Promise<void> {
  await getBd().runAsync(`DELETE FROM lista_compras`);
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
 * Tira/devolve um item ao ranking por loja SEM mexer na lista de compras
 * (ver cabeçalho). É o que o "x" da tela Comparar mercados faz.
 */
export async function definirForaComparacao(
  produtoCanonicoId: string,
  fora: boolean,
): Promise<void> {
  await getBd().runAsync(
    `UPDATE lista_compras SET fora_comparacao = ? WHERE produto_canonico_id = ?`,
    [fora ? 1 : 0, produtoCanonicoId],
  );
}

/** Devolve todos os itens excluídos ao ranking — o "voltar tudo" da tela. */
export async function incluirTodosNaComparacao(): Promise<void> {
  await getBd().runAsync(`UPDATE lista_compras SET fora_comparacao = 0`);
}

/**
 * A cesta que de fato vai ao endpoint de comparação: a lista MENOS o que foi
 * excluído. Uma função só para as duas telas que comparam (aba Lista e Comparar
 * mercados) — se cada uma montasse a sua, elas voltariam a divergir.
 */
export function cestaComparavel(itens: readonly ItemLista[]): ItemLista[] {
  return itens.filter((i) => !i.foraComparacao);
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
