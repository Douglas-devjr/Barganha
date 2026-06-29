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

/**
 * C6.2 — Vincula o `cupomIdServidor` após o upload bem-sucedido, sem mexer nos
 * itens (que só chegam quando o backend termina o parsing). `chaveAcesso` é
 * preenchida se o servidor a devolveu (idempotência local passa a valer).
 */
export async function vincularServidor(
  id: string,
  cupomIdServidor: string,
  status: StatusCupom,
  chaveAcesso?: string,
): Promise<void> {
  await getBd().runAsync(
    `UPDATE cupom_local
        SET cupom_id_servidor = ?, status = ?, chave_acesso = COALESCE(?, chave_acesso),
            atualizado_em = ?
      WHERE id = ?`,
    [cupomIdServidor, status, chaveAcesso ?? null, agoraIso(), id],
  );
}

/**
 * Cupons já enviados (têm id de servidor) mas ainda não finalizados — aguardam o
 * parsing assíncrono. Base do polling de processamento (C6.2/C6.3).
 */
export async function listarAguardandoProcessamento(): Promise<CupomLocal[]> {
  const linhas = await getBd().getAllAsync<LinhaCupom>(
    `SELECT * FROM cupom_local
      WHERE cupom_id_servidor IS NOT NULL AND status = 'qr_capturado'
      ORDER BY capturado_em ASC`,
  );
  return linhas.map(mapearCupom);
}

/** Remove o cupom local (e, em cascata, itens e fila). Usado por "Descartar". */
export async function excluir(id: string): Promise<void> {
  await getBd().runAsync(`DELETE FROM cupom_local WHERE id = ?`, [id]);
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

/** Resumo agregado do histórico — base do card de economia da Início (C8.1). */
export interface ResumoCompras {
  /** Notas já processadas (com itens). */
  totalCupons: number;
  totalItens: number;
  /** Soma dos valores dos itens (R$) das notas processadas. */
  gastoTotal: number;
  /** Soma dos descontos de promoção registrados nas notas (R$). */
  economiaTotal: number;
}

/**
 * Agrega o histórico PRIVADO processado. `economiaTotal` é a soma honesta dos
 * descontos que a própria NFC-e registrou (promoção real no caixa), nunca uma
 * estimativa estatística — esta fica para C8.3/C8.4 (Pós).
 */
export async function resumoCompras(): Promise<ResumoCompras> {
  const linha = await getBd().getFirstAsync<{
    total_cupons: number;
    total_itens: number;
    gasto_total: number;
    economia_total: number;
  }>(
    `SELECT
       COUNT(DISTINCT c.id)                                          AS total_cupons,
       COUNT(i.id)                                                   AS total_itens,
       COALESCE(SUM(i.valor_total), 0)                               AS gasto_total,
       COALESCE(SUM(CASE WHEN i.desconto > 0 THEN i.desconto END), 0) AS economia_total
     FROM cupom_local c
     LEFT JOIN item_cupom_local i ON i.cupom_local_id = c.id
     WHERE c.status = 'processado'`,
  );
  return {
    totalCupons: linha?.total_cupons ?? 0,
    totalItens: linha?.total_itens ?? 0,
    gastoTotal: linha?.gasto_total ?? 0,
    economiaTotal: linha?.economia_total ?? 0,
  };
}

/** Total de cupons capturados (todos os status) — Perfil "cupons escaneados". */
export async function contarCupons(): Promise<number> {
  const linha = await getBd().getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM cupom_local`,
  );
  return linha?.total ?? 0;
}

/** Uma compra (cupom) resumida para a lista "Últimas compras" (C8.1). */
export interface CompraResumo {
  cupomLocalId: string;
  lojaNome: string | null;
  /** Emissão da nota; cai para a captura enquanto não processada. ISO 8601. */
  observadoEm: string;
  status: StatusCupom;
  totalItens: number;
  valorTotal: number;
  /** Desconto de promoção registrado nesta nota (R$). */
  economia: number;
}

/**
 * Cupons recentes (todos os status, inclusive os ainda em processamento —
 * offline-first), do mais novo ao mais antigo, com total e desconto agregados.
 */
export async function listarComprasRecentes(limite = 6): Promise<CompraResumo[]> {
  const linhas = await getBd().getAllAsync<{
    cupom_local_id: string;
    loja_nome: string | null;
    observado_em: string;
    status: string;
    total_itens: number;
    valor_total: number;
    economia: number;
  }>(
    `SELECT
       c.id                                   AS cupom_local_id,
       c.loja_nome                            AS loja_nome,
       COALESCE(c.emitido_em, c.capturado_em) AS observado_em,
       c.status                               AS status,
       COUNT(i.id)                            AS total_itens,
       COALESCE(SUM(i.valor_total), 0)        AS valor_total,
       COALESCE(SUM(CASE WHEN i.desconto > 0 THEN i.desconto END), 0) AS economia
     FROM cupom_local c
     LEFT JOIN item_cupom_local i ON i.cupom_local_id = c.id
     GROUP BY c.id
     ORDER BY observado_em DESC
     LIMIT ?`,
    [limite],
  );
  return linhas.map((l) => ({
    cupomLocalId: l.cupom_local_id,
    lojaNome: l.loja_nome,
    observadoEm: l.observado_em,
    status: l.status as StatusCupom,
    totalItens: l.total_itens,
    valorTotal: l.valor_total,
    economia: l.economia,
  }));
}

/** Mercado onde o usuário compra, com frequência — Perfil "seus mercados" (C8.2). */
export interface MercadoFrequente {
  lojaNome: string;
  visitas: number;
  /** Última visita (emissão/captura). ISO 8601. */
  ultimaVisitaEm: string;
}

/**
 * Mercados mais frequentes do histórico, derivados da LOJA das notas (nunca do
 * usuário — decisão travada). Só notas processadas, que têm loja identificada.
 */
export async function listarMercadosFrequentes(limite = 5): Promise<MercadoFrequente[]> {
  const linhas = await getBd().getAllAsync<{
    loja_nome: string;
    visitas: number;
    ultima_visita_em: string;
  }>(
    `SELECT
       c.loja_nome                                 AS loja_nome,
       COUNT(*)                                    AS visitas,
       MAX(COALESCE(c.emitido_em, c.capturado_em)) AS ultima_visita_em
     FROM cupom_local c
     WHERE c.status = 'processado' AND c.loja_nome IS NOT NULL
     GROUP BY c.loja_nome
     ORDER BY visitas DESC, ultima_visita_em DESC
     LIMIT ?`,
    [limite],
  );
  return linhas.map((l) => ({
    lojaNome: l.loja_nome,
    visitas: l.visitas,
    ultimaVisitaEm: l.ultima_visita_em,
  }));
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
