/**
 * C5.3 — Repositório do cupom local (espelho privado offline-first, docs/05).
 *
 * `registrarCaptura` é o coração do offline: grava o QR cru imediatamente e o
 * enfileira para upload — funciona sem sinal (C6.1/C6.2). O parsing e a nota
 * estruturada vêm do backend e chegam depois via `aplicarProcessamento`.
 */

import type { StatusCupom } from '@barganha/shared';

import { agoraIso, gerarIdLocal } from '@/nucleo/id';

import { getBd } from './bd';
import type { CupomLocal, ItemCupomLocal } from './tipos';

interface LinhaCupom {
  id: string;
  cupom_id_servidor: string | null;
  qr_payload: string;
  chave_acesso: string | null;
  capturado_em: string;
  status: string;
  loja_cnpj: string | null;
  loja_nome: string | null;
  emitido_em: string | null;
  uf: string | null;
  criado_em: string;
  atualizado_em: string;
}

function mapearCupom(l: LinhaCupom): CupomLocal {
  return {
    id: l.id,
    cupomIdServidor: l.cupom_id_servidor,
    qrPayload: l.qr_payload,
    chaveAcesso: l.chave_acesso,
    capturadoEm: l.capturado_em,
    status: l.status as StatusCupom,
    lojaCnpj: l.loja_cnpj,
    lojaNome: l.loja_nome,
    emitidoEm: l.emitido_em,
    uf: l.uf,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
  };
}

export interface NovaCaptura {
  qrPayload: string;
  /** Instante da leitura do QR (ISO). Padrão: agora. */
  capturadoEm?: string;
  /** Chave de acesso, se já extraída do QR no app (idempotência local). */
  chaveAcesso?: string;
}

/** Grava o QR cru local + enfileira upload, numa transação. Retorna o cupom. */
export async function registrarCaptura(captura: NovaCaptura): Promise<CupomLocal> {
  const db = getBd();
  const id = gerarIdLocal();
  const agora = agoraIso();
  const capturadoEm = captura.capturadoEm ?? agora;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO cupom_local
         (id, qr_payload, chave_acesso, capturado_em, status, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, 'qr_capturado', ?, ?)`,
      [id, captura.qrPayload, captura.chaveAcesso ?? null, capturadoEm, agora, agora],
    );
    await db.runAsync(`INSERT INTO fila_upload (cupom_local_id, criado_em) VALUES (?, ?)`, [
      id,
      agora,
    ]);
  });

  const cupom = await obterCupom(id);
  if (!cupom) throw new Error('Falha ao registrar a captura do cupom.');
  return cupom;
}

export async function listarCupons(): Promise<CupomLocal[]> {
  const linhas = await getBd().getAllAsync<LinhaCupom>(
    `SELECT * FROM cupom_local ORDER BY capturado_em DESC`,
  );
  return linhas.map(mapearCupom);
}

export async function obterCupom(id: string): Promise<CupomLocal | null> {
  const linha = await getBd().getFirstAsync<LinhaCupom>(`SELECT * FROM cupom_local WHERE id = ?`, [
    id,
  ]);
  return linha ? mapearCupom(linha) : null;
}

export async function atualizarStatus(id: string, status: StatusCupom): Promise<void> {
  await getBd().runAsync(`UPDATE cupom_local SET status = ?, atualizado_em = ? WHERE id = ?`, [
    status,
    agoraIso(),
    id,
  ]);
}

/** Dados que o backend devolve após processar a nota (preenche a nota local). */
export interface ResultadoProcessamento {
  cupomIdServidor: string;
  status: StatusCupom;
  chaveAcesso?: string;
  lojaCnpj?: string;
  lojaNome?: string;
  emitidoEm?: string;
  uf?: string;
  itens: Omit<ItemCupomLocal, 'id' | 'cupomLocalId'>[];
}

/** Aplica o resultado do backend ao cupom local (cabeçalho + itens), em transação. */
export async function aplicarProcessamento(
  cupomLocalId: string,
  r: ResultadoProcessamento,
): Promise<void> {
  const db = getBd();
  const agora = agoraIso();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE cupom_local
          SET cupom_id_servidor = ?, status = ?, chave_acesso = COALESCE(?, chave_acesso),
              loja_cnpj = ?, loja_nome = ?, emitido_em = ?, uf = ?, atualizado_em = ?
        WHERE id = ?`,
      [
        r.cupomIdServidor,
        r.status,
        r.chaveAcesso ?? null,
        r.lojaCnpj ?? null,
        r.lojaNome ?? null,
        r.emitidoEm ?? null,
        r.uf ?? null,
        agora,
        cupomLocalId,
      ],
    );
    await db.runAsync(`DELETE FROM item_cupom_local WHERE cupom_local_id = ?`, [cupomLocalId]);
    for (const item of r.itens) {
      await db.runAsync(
        `INSERT INTO item_cupom_local
           (id, cupom_local_id, produto_canonico_id, descricao_original, ean,
            quantidade, unidade, valor_unitario, valor_total, desconto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          gerarIdLocal(),
          cupomLocalId,
          item.produtoCanonicoId,
          item.descricaoOriginal,
          item.ean,
          item.quantidade,
          item.unidade,
          item.valorUnitario,
          item.valorTotal,
          item.desconto,
        ],
      );
    }
  });
}

export async function listarItens(cupomLocalId: string): Promise<ItemCupomLocal[]> {
  const linhas = await getBd().getAllAsync<{
    id: string;
    cupom_local_id: string;
    produto_canonico_id: string | null;
    descricao_original: string;
    ean: string | null;
    quantidade: number;
    unidade: string;
    valor_unitario: number;
    valor_total: number;
    desconto: number | null;
  }>(`SELECT * FROM item_cupom_local WHERE cupom_local_id = ?`, [cupomLocalId]);

  return linhas.map((l) => ({
    id: l.id,
    cupomLocalId: l.cupom_local_id,
    produtoCanonicoId: l.produto_canonico_id,
    descricaoOriginal: l.descricao_original,
    ean: l.ean,
    quantidade: l.quantidade,
    unidade: l.unidade,
    valorUnitario: l.valor_unitario,
    valorTotal: l.valor_total,
    desconto: l.desconto,
  }));
}
