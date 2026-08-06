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
 *
 * Item PENDENTE ("a escolher no mercado" — nunca "genérico" na UI, ver
 * `FolhaAdicionarItem`) tem `produtoCanonicoId: null`: a pessoa quer o produto
 * na lista antes de decidir a marca. A PK deixou de ser `produtoCanonicoId` (v12)
 * porque um item pendente não tem um id para ser chave — a nova PK é `id`
 * (gerado local, como `cupom_local`/`notificacao`), e `chave` virou o alvo da
 * de-duplicação (id canônico OU descrição normalizada — ver `nucleo/lista-regras`).
 */

import { calcularChaveItemLista } from '../nucleo/lista-regras';
import { agoraIso, gerarIdLocal } from '../nucleo/id';
import { getBd } from './bd';

export interface ItemLista {
  id: string;
  /** `null` = item PENDENTE, ainda "a escolher no mercado" (sem marca definida). */
  produtoCanonicoId: string | null;
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
  id: string;
  produto_canonico_id: string | null;
  chave: string;
  nome: string;
  quantidade: number;
  marcado: number;
  fora_comparacao: number;
  criado_em: string;
}

function mapear(l: LinhaLista): ItemLista {
  return {
    id: l.id,
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
 * Adiciona (ou re-adiciona) um produto IDENTIFICADO; repetir não duplica nem
 * zera a quantidade. Re-adicionar traz o item de volta para a comparação: quem
 * busca e adiciona de novo está dizendo que quer este item na conta.
 */
export async function adicionar(produtoCanonicoId: string, nome: string): Promise<void> {
  const chave = calcularChaveItemLista(produtoCanonicoId, nome);
  await getBd().runAsync(
    `INSERT INTO lista_compras
       (id, produto_canonico_id, chave, nome, quantidade, marcado, fora_comparacao, criado_em)
     VALUES (?, ?, ?, ?, 1, 0, 0, ?)
     ON CONFLICT (chave) DO UPDATE SET
       nome = excluded.nome,
       fora_comparacao = 0`,
    [gerarIdLocal(), produtoCanonicoId, chave, nome, agoraIso()],
  );
}

/**
 * Adiciona um item PENDENTE — "a escolher no mercado", sem marca definida ainda
 * (nunca "genérico" na UI). Repetir o mesmo nome não duplica: cai na mesma linha
 * (mesma chave), pelo mesmo motivo de `adicionar`.
 */
export async function adicionarGenerico(nome: string): Promise<void> {
  const chave = calcularChaveItemLista(null, nome);
  await getBd().runAsync(
    `INSERT INTO lista_compras
       (id, produto_canonico_id, chave, nome, quantidade, marcado, fora_comparacao, criado_em)
     VALUES (?, NULL, ?, ?, 1, 0, 0, ?)
     ON CONFLICT (chave) DO UPDATE SET
       nome = excluded.nome,
       fora_comparacao = 0`,
    [gerarIdLocal(), chave, nome, agoraIso()],
  );
}

/**
 * Promove um item PENDENTE para o produto real, identificado por escaneamento
 * (correio scan → lista, `nucleo/scan-pendente`). Mantém a quantidade e marca
 * `marcado = true` — a pessoa já está com o produto na mão, na gôndola.
 *
 * Devolve o nome ANTERIOR (o do item pendente), para a tela montar o toast de
 * confirmação; `null` quando o item já não existe (removido, lista limpa etc.
 * entre o disparo do scan e a resposta chegar).
 *
 * Caso de borda: já existe uma linha ESPECÍFICA para este `produtoCanonicoId`
 * (a pessoa também já tinha adicionado o produto certo, ou resolveu duas linhas
 * pendentes para o mesmo item). A chave já está ocupada — em vez de tentar um
 * UPDATE que colidiria com o índice único, soma a quantidade na linha
 * específica existente e apaga a pendente.
 */
export async function resolverGenerico(
  itemListaId: string,
  produtoCanonicoId: string,
  nome: string,
): Promise<string | null> {
  const bd = getBd();
  const generico = await bd.getFirstAsync<LinhaLista>(`SELECT * FROM lista_compras WHERE id = ?`, [
    itemListaId,
  ]);
  if (!generico) return null;

  const existente = await bd.getFirstAsync<LinhaLista>(
    `SELECT * FROM lista_compras WHERE chave = ? AND id != ?`,
    [produtoCanonicoId, itemListaId],
  );

  if (existente) {
    await bd.runAsync(
      `UPDATE lista_compras
          SET quantidade = quantidade + ?, marcado = 1, fora_comparacao = 0
        WHERE id = ?`,
      [generico.quantidade, existente.id],
    );
    await bd.runAsync(`DELETE FROM lista_compras WHERE id = ?`, [itemListaId]);
    return generico.nome;
  }

  await bd.runAsync(
    `UPDATE lista_compras
        SET produto_canonico_id = ?, chave = ?, nome = ?, marcado = 1, fora_comparacao = 0
      WHERE id = ?`,
    [produtoCanonicoId, produtoCanonicoId, nome, itemListaId],
  );
  return generico.nome;
}

/** Tira uma linha da lista pelo seu id (funciona para item específico ou pendente). */
export async function remover(id: string): Promise<void> {
  await getBd().runAsync(`DELETE FROM lista_compras WHERE id = ?`, [id]);
}

/**
 * Tira da lista pelo id CANÔNICO — para telas que só conhecem o produto (nunca
 * um item pendente), como Editar produto / Detalhe do produto. Como a chave de
 * um item específico É o próprio id canônico, a busca é direta e inequívoca.
 */
export async function removerPorProdutoCanonicoId(produtoCanonicoId: string): Promise<void> {
  await getBd().runAsync(`DELETE FROM lista_compras WHERE chave = ?`, [produtoCanonicoId]);
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
export async function definirQuantidade(id: string, quantidade: number): Promise<void> {
  await getBd().runAsync(`UPDATE lista_compras SET quantidade = ? WHERE id = ?`, [
    Math.max(1, quantidade),
    id,
  ]);
}

/** Marca/desmarca "já está no carrinho". */
export async function definirMarcado(id: string, marcado: boolean): Promise<void> {
  await getBd().runAsync(`UPDATE lista_compras SET marcado = ? WHERE id = ?`, [
    marcado ? 1 : 0,
    id,
  ]);
}

/** Desmarca tudo — o "recomeçar a compra" depois de passar no caixa. */
export async function desmarcarTodos(): Promise<void> {
  await getBd().runAsync(`UPDATE lista_compras SET marcado = 0`);
}

/**
 * Tira/devolve um item ao ranking por loja SEM mexer na lista de compras (ver
 * cabeçalho). É o que o "x" da tela Comparar mercados faz — sempre sobre um item
 * já IDENTIFICADO (a cesta comparável já exclui item pendente, ver
 * `cestaComparavel`), então o id canônico basta e é inequívoco.
 */
export async function definirForaComparacao(
  produtoCanonicoId: string,
  fora: boolean,
): Promise<void> {
  await getBd().runAsync(`UPDATE lista_compras SET fora_comparacao = ? WHERE chave = ?`, [
    fora ? 1 : 0,
    produtoCanonicoId,
  ]);
}

/** Devolve todos os itens excluídos ao ranking — o "voltar tudo" da tela. */
export async function incluirTodosNaComparacao(): Promise<void> {
  await getBd().runAsync(`UPDATE lista_compras SET fora_comparacao = 0`);
}

/** Um item da lista já IDENTIFICADO — `produtoCanonicoId` deixa de ser nulável. */
export type ItemListaResolvido = ItemLista & { produtoCanonicoId: string };

/**
 * A cesta que de fato vai ao endpoint de comparação: a lista MENOS o que foi
 * excluído E MENOS o que ainda está pendente ("a escolher no mercado") — sem
 * marca definida não há o que comparar entre lojas. Uma função só para as duas
 * telas que comparam (aba Lista e Comparar mercados) — se cada uma montasse a
 * sua, elas voltariam a divergir.
 */
export function cestaComparavel(itens: readonly ItemLista[]): ItemListaResolvido[] {
  return itens.filter(
    (i): i is ItemListaResolvido => !i.foraComparacao && i.produtoCanonicoId != null,
  );
}

/**
 * Ids da lista para o recorte do delta sync (C7.7). Desde o C7.6 a lista pode
 * conter produto vindo do catálogo REGIONAL, que o usuário nunca comprou: sem
 * entrar aqui, ele ficaria fora do sync e sem típico offline — justo o item que
 * a pessoa acabou de dizer que quer comprar. Item PENDENTE (sem marca ainda)
 * não tem o que sincronizar e fica de fora.
 */
export async function listarProdutoCanonicoIds(): Promise<string[]> {
  const linhas = await getBd().getAllAsync<{ produto_canonico_id: string }>(
    `SELECT produto_canonico_id FROM lista_compras WHERE produto_canonico_id IS NOT NULL`,
  );
  return linhas.map((l) => l.produto_canonico_id);
}

/** Se o produto (já identificado) está na lista — estado do botão "adicionar". */
export async function contem(produtoCanonicoId: string): Promise<boolean> {
  const linha = await getBd().getFirstAsync<{ um: number }>(
    `SELECT 1 AS um FROM lista_compras WHERE chave = ? LIMIT 1`,
    [produtoCanonicoId],
  );
  return linha != null;
}
