/**
 * C8.4 — Alertas de preço LOCAIS. O alvo é em R$/unidade-base do produto e a
 * checagem acontece no aparelho (nucleo/alertas) contra o cache regional — v1
 * sem push: o aviso aparece no Início quando o app abre/foca. O alerta vive só
 * no aparelho (preferência do usuário), nada viaja para o servidor.
 */

import { getBd } from './bd';

export interface AlertaPreco {
  produtoCanonicoId: string;
  nome: string;
  /** Alvo em R$ por unidade-base do produto (kg, L ou un). */
  precoAlvo: number;
  criadoEm: string;
}

interface LinhaAlerta {
  produto_canonico_id: string;
  nome: string;
  preco_alvo: number;
  criado_em: string;
}

function mapear(l: LinhaAlerta): AlertaPreco {
  return {
    produtoCanonicoId: l.produto_canonico_id,
    nome: l.nome,
    precoAlvo: l.preco_alvo,
    criadoEm: l.criado_em,
  };
}

export async function listar(): Promise<AlertaPreco[]> {
  const linhas = await getBd().getAllAsync<LinhaAlerta>(
    `SELECT * FROM alerta_preco ORDER BY criado_em ASC`,
  );
  return linhas.map(mapear);
}

export async function obter(produtoCanonicoId: string): Promise<AlertaPreco | null> {
  const linha = await getBd().getFirstAsync<LinhaAlerta>(
    `SELECT * FROM alerta_preco WHERE produto_canonico_id = ?`,
    [produtoCanonicoId],
  );
  return linha ? mapear(linha) : null;
}

/** Cria ou atualiza o alerta do produto (um alvo por produto). */
export async function definir(
  produtoCanonicoId: string,
  nome: string,
  precoAlvo: number,
): Promise<void> {
  await getBd().runAsync(
    `INSERT INTO alerta_preco (produto_canonico_id, nome, preco_alvo, criado_em)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (produto_canonico_id) DO UPDATE SET
       nome = excluded.nome,
       preco_alvo = excluded.preco_alvo`,
    [produtoCanonicoId, nome, precoAlvo, new Date().toISOString()],
  );
}

export async function remover(produtoCanonicoId: string): Promise<void> {
  await getBd().runAsync(`DELETE FROM alerta_preco WHERE produto_canonico_id = ?`, [
    produtoCanonicoId,
  ]);
}
