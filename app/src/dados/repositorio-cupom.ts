/**
 * C5.3 — Repositório do cupom local (espelho privado offline-first, docs/05).
 *
 * `registrarCaptura` é o coração do offline: grava o QR cru imediatamente e o
 * enfileira para upload — funciona sem sinal (C6.1/C6.2). O parsing e a nota
 * estruturada vêm do backend e chegam depois via `aplicarProcessamento`.
 */

import type { StatusCupom, TipicoNaCompra } from '@barganha/shared';

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
  desconto_total: number | null;
  valor_pago: number | null;
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
    descontoTotal: l.desconto_total,
    valorPago: l.valor_pago,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
  };
}

/**
 * As 4 colunas do típico congelado, na ordem do INSERT. Os campos andam SEMPRE
 * juntos: mediana sem escopo/`n` não é auditável, então ou grava tudo ou grava
 * NULL em tudo. Ter isto num lugar só evita que os dois INSERTs de item
 * (processamento e restore) divirjam.
 */
function colunasTipico(
  t: TipicoNaCompra | null,
): [number, string, string, number] | [null, null, null, null] {
  return t ? [t.mediana, t.unidadeBase, t.escopo, t.nObservacoes] : [null, null, null, null];
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

  // Exclusiva, não `withTransactionAsync`: ver nota em `aplicarProcessamento`.
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO cupom_local
         (id, qr_payload, chave_acesso, capturado_em, status, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, 'qr_capturado', ?, ?)`,
      [id, captura.qrPayload, captura.chaveAcesso ?? null, capturadoEm, agora, agora],
    );
    await txn.runAsync(`INSERT INTO fila_upload (cupom_local_id, criado_em) VALUES (?, ?)`, [
      id,
      agora,
    ]);
  });

  const cupom = await obterCupom(id);
  if (!cupom) throw new Error('Falha ao registrar a captura do cupom.');
  return cupom;
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
 *
 * Se OUTRA captura local já espelha esta nota (índice único de `chave_acesso` —
 * o mesmo cupom foi escaneado duas vezes), mantém o vínculo SEM a chave: o
 * espelho duplicado segue funcional em vez de travar a fila em retry eterno.
 */
export async function vincularServidor(
  id: string,
  cupomIdServidor: string,
  status: StatusCupom,
  chaveAcesso?: string,
): Promise<void> {
  const executar = (chave: string | null) =>
    getBd().runAsync(
      `UPDATE cupom_local
          SET cupom_id_servidor = ?, status = ?, chave_acesso = COALESCE(?, chave_acesso),
              atualizado_em = ?
        WHERE id = ?`,
      [cupomIdServidor, status, chave, agoraIso(), id],
    );
  try {
    await executar(chaveAcesso ?? null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (chaveAcesso == null || !/UNIQUE constraint/i.test(msg)) throw e;
    await executar(null);
  }
}

/**
 * Cupons já enviados (têm id de servidor) mas ainda não finalizados — aguardam o
 * parsing assíncrono. Base do polling de processamento (C6.2/C6.3).
 *
 * Inclui também o cupom `processado` SEM itens locais: é um espelho incompleto
 * (ex.: dedup do servidor num re-scan antes da correção, ou uma busca de itens
 * que falhou no meio) — o polling o completa em vez de deixá-lo vazio p/ sempre.
 */
export async function listarAguardandoProcessamento(): Promise<CupomLocal[]> {
  const linhas = await getBd().getAllAsync<LinhaCupom>(
    `SELECT * FROM cupom_local c
      WHERE c.cupom_id_servidor IS NOT NULL
        AND (c.status = 'qr_capturado'
             OR (c.status = 'processado'
                 AND NOT EXISTS (SELECT 1 FROM item_cupom_local i WHERE i.cupom_local_id = c.id)))
      ORDER BY c.capturado_em ASC`,
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
  /** Desconto total do cupom (R$), quando o portal informa (C2.6). */
  descontoTotal?: number;
  /** Valor efetivamente pago (R$). */
  valorPago?: number;
  itens: Omit<ItemCupomLocal, 'id' | 'cupomLocalId'>[];
}

/** Aplica o resultado do backend ao cupom local (cabeçalho + itens), em transação. */
export async function aplicarProcessamento(
  cupomLocalId: string,
  r: ResultadoProcessamento,
): Promise<void> {
  const db = getBd();
  const agora = agoraIso();

  // `withExclusiveTransactionAsync`, NUNCA `withTransactionAsync`: a versão não
  // exclusiva do expo-sqlite compartilha a conexão, então dois BEGIN/COMMIT
  // podem se intercalar. Isto aqui roda tanto na rodada de sync de fundo quanto
  // no polling da tela Nota fiscal — quando as duas se cruzavam, uma commitava a
  // transação da outra e o rollback órfão estourava "cannot rollback - no
  // transaction is active", perdendo a gravação dos itens.
  await db.withExclusiveTransactionAsync(async (txn) => {
    // `COALESCE(?, coluna)` nos totais: uma re-sincronização sem os totais (ex.:
    // via GET, que não os carrega) não apaga os já gravados na captura (C2.6).
    await txn.runAsync(
      `UPDATE cupom_local
          SET cupom_id_servidor = ?, status = ?, chave_acesso = COALESCE(?, chave_acesso),
              loja_cnpj = ?, loja_nome = ?, emitido_em = ?, uf = ?,
              desconto_total = COALESCE(?, desconto_total),
              valor_pago = COALESCE(?, valor_pago), atualizado_em = ?
        WHERE id = ?`,
      [
        r.cupomIdServidor,
        r.status,
        r.chaveAcesso ?? null,
        r.lojaCnpj ?? null,
        r.lojaNome ?? null,
        r.emitidoEm ?? null,
        r.uf ?? null,
        r.descontoTotal ?? null,
        r.valorPago ?? null,
        agora,
        cupomLocalId,
      ],
    );
    await txn.runAsync(`DELETE FROM item_cupom_local WHERE cupom_local_id = ?`, [cupomLocalId]);
    for (const item of r.itens) {
      await txn.runAsync(
        `INSERT INTO item_cupom_local
           (id, cupom_local_id, produto_canonico_id, descricao_original, ean,
            quantidade, unidade, valor_unitario, valor_total, desconto,
            tipico_mediana, tipico_unidade_base, tipico_escopo, tipico_n_observacoes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          ...colunasTipico(item.tipicoNaCompra),
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
 * Agrega o histórico PRIVADO processado. `gastoTotal` é o valor REALMENTE pago
 * (bruto − desconto do cupom, C2.6), não a soma crua dos itens. `economiaTotal`
 * usa o desconto total da nota quando existe (autoritativo); senão, a soma dos
 * descontos marcados por item. Sempre o desconto honesto da NFC-e, nunca
 * estimativa (isso é C8.3/C8.4, Pós). Agrega por cupom antes de somar.
 */
export async function resumoCompras(): Promise<ResumoCompras> {
  const linha = await getBd().getFirstAsync<{
    total_cupons: number;
    total_itens: number;
    gasto_total: number;
    economia_total: number;
  }>(
    `SELECT
       COUNT(*)                                                        AS total_cupons,
       COALESCE(SUM(x.total_itens), 0)                                 AS total_itens,
       COALESCE(SUM(COALESCE(x.valor_pago, x.bruto - x.desc_itens)), 0) AS gasto_total,
       COALESCE(SUM(COALESCE(x.desconto_total, x.desc_itens)), 0)       AS economia_total
     FROM (
       SELECT
         c.valor_pago                                                  AS valor_pago,
         c.desconto_total                                              AS desconto_total,
         COUNT(i.id)                                                   AS total_itens,
         COALESCE(SUM(i.valor_total), 0)                               AS bruto,
         COALESCE(SUM(CASE WHEN i.desconto > 0 THEN i.desconto END), 0) AS desc_itens
       FROM cupom_local c
       LEFT JOIN item_cupom_local i ON i.cupom_local_id = c.id
       WHERE c.status = 'processado'
       GROUP BY c.id
     ) x`,
  );
  return {
    totalCupons: linha?.total_cupons ?? 0,
    totalItens: linha?.total_itens ?? 0,
    gastoTotal: linha?.gasto_total ?? 0,
    economiaTotal: linha?.economia_total ?? 0,
  };
}

/**
 * C8.4 — Economia (descontos honestos da NFC-e) agregada POR MÊS ("AAAA-MM",
 * fuso local do aparelho), mais recente primeiro. Mesma regra do resumo: o
 * `desconto_total` do cupom é autoritativo; sem ele, a soma dos descontos por
 * item. Base do chip de tendência (este mês vs anterior).
 */
export interface EconomiaMensal {
  /** "AAAA-MM". */
  mes: string;
  economia: number;
}

export async function economiaPorMes(limite = 12): Promise<EconomiaMensal[]> {
  const linhas = await getBd().getAllAsync<{ mes: string; economia: number }>(
    `SELECT
       strftime('%Y-%m', COALESCE(x.emitido_em, x.capturado_em)) AS mes,
       COALESCE(SUM(COALESCE(x.desconto_total, x.desc_itens)), 0) AS economia
     FROM (
       SELECT
         c.emitido_em                                                   AS emitido_em,
         c.capturado_em                                                 AS capturado_em,
         c.desconto_total                                               AS desconto_total,
         COALESCE(SUM(CASE WHEN i.desconto > 0 THEN i.desconto END), 0) AS desc_itens
       FROM cupom_local c
       LEFT JOIN item_cupom_local i ON i.cupom_local_id = c.id
       WHERE c.status = 'processado'
       GROUP BY c.id
     ) x
     GROUP BY mes
     ORDER BY mes DESC
     LIMIT ?`,
    [limite],
  );
  return linhas.map((l) => ({ mes: l.mes, economia: l.economia }));
}

/**
 * Onde a economia veio, por PRODUTO (tela de Resumo de economia). Soma o
 * desconto por item, do maior para o menor.
 *
 * O handoff agrupa por CATEGORIA (Laticínios, Café…), mas categoria só existe
 * no enriquecimento do backend (C11.5) e não desce para o catálogo local — não
 * dá para agrupar assim offline sem inventar o rótulo. Produto é o agrupamento
 * mais específico que o aparelho realmente tem, e responde a mesma pergunta.
 *
 * `mes` opcional ("AAAA-MM") recorta o período; sem ele, o histórico todo.
 */
export interface EconomiaPorProduto {
  nome: string;
  economia: number;
}

export async function economiaPorProduto(limite = 5, mes?: string): Promise<EconomiaPorProduto[]> {
  const filtroMes = mes ? `AND strftime('%Y-%m', COALESCE(c.emitido_em, c.capturado_em)) = ?` : '';
  const params: (string | number)[] = mes ? [mes, limite] : [limite];

  const linhas = await getBd().getAllAsync<{ nome: string; economia: number }>(
    `SELECT
       i.descricao_original AS nome,
       SUM(i.desconto)      AS economia
     FROM item_cupom_local i
     JOIN cupom_local c ON c.id = i.cupom_local_id
     WHERE c.status = 'processado'
       AND i.desconto > 0
       ${filtroMes}
     GROUP BY i.descricao_original
     ORDER BY economia DESC
     LIMIT ?`,
    params,
  );
  return linhas.map((l) => ({ nome: l.nome, economia: l.economia }));
}

/**
 * C12.2 — Datas de captura de TODOS os cupons (qualquer status): escanear já é
 * contribuir, mesmo antes do parsing. Base da sequência de semanas e dos selos.
 */
export async function listarDatasCapturas(): Promise<string[]> {
  const linhas = await getBd().getAllAsync<{ capturado_em: string }>(
    `SELECT capturado_em FROM cupom_local ORDER BY capturado_em ASC`,
  );
  return linhas.map((l) => l.capturado_em);
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
    // `valor_total` é o valor REALMENTE pago (líquido); `economia`, o desconto do
    // cupom quando a nota o traz (C2.6), com fallback nos descontos por item.
    `SELECT
       c.id                                   AS cupom_local_id,
       c.loja_nome                            AS loja_nome,
       COALESCE(c.emitido_em, c.capturado_em) AS observado_em,
       c.status                               AS status,
       COUNT(i.id)                            AS total_itens,
       COALESCE(
         c.valor_pago,
         COALESCE(SUM(i.valor_total), 0)
           - COALESCE(SUM(CASE WHEN i.desconto > 0 THEN i.desconto END), 0)
       )                                      AS valor_total,
       COALESCE(
         c.desconto_total,
         COALESCE(SUM(CASE WHEN i.desconto > 0 THEN i.desconto END), 0)
       )                                      AS economia
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
    tipico_mediana: number | null;
    tipico_unidade_base: string | null;
    tipico_escopo: string | null;
    tipico_n_observacoes: number | null;
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
    // Só monta com os QUATRO presentes: mediana sem escopo/`n` não é auditável.
    tipicoNaCompra:
      l.tipico_mediana != null &&
      l.tipico_unidade_base != null &&
      l.tipico_escopo != null &&
      l.tipico_n_observacoes != null
        ? {
            mediana: l.tipico_mediana,
            unidadeBase: l.tipico_unidade_base as TipicoNaCompra['unidadeBase'],
            escopo: l.tipico_escopo as TipicoNaCompra['escopo'],
            nObservacoes: l.tipico_n_observacoes,
          }
        : null,
  }));
}

/**
 * C2.6 — Marca (ou limpa) o desconto de UM item, informado pelo usuário quando o
 * cupom traz desconto mas o portal não diz em qual item. Fica só no histórico
 * PRIVADO local (a base compartilhada não é tocada, docs/04). `null`/0 limpa.
 */
export async function definirDescontoItem(itemId: string, desconto: number | null): Promise<void> {
  const valor = desconto && desconto > 0 ? desconto : null;
  await getBd().runAsync(`UPDATE item_cupom_local SET desconto = ? WHERE id = ?`, [valor, itemId]);
}
