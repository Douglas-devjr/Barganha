/**
 * C7.4/C7.5 — Leituras do histórico privado para o catálogo de produtos e o
 * veredito pessoal. Junta `item_cupom_local` ao `cupom_local` (loja + data) e
 * devolve OBSERVAÇÕES soltas; o agrupamento por produto e o cálculo da faixa
 * pessoal acontecem no núcleo (`@/nucleo/catalogo`), reusando `@barganha/shared`.
 *
 * Lê só o lado PRIVADO local — nada aqui toca o pool compartilhado (docs/04).
 */

import { getBd } from './bd';

/** Uma compra do usuário, com o contexto do cupom (loja/data) para o histórico. */
export interface ObservacaoLocal {
  itemId: string;
  produtoCanonicoId: string | null;
  descricaoOriginal: string;
  ean: string | null;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
  desconto: number | null;
  lojaNome: string | null;
  /** Instante da compra (emissão da nota; cai p/ a captura). ISO 8601. */
  observadoEm: string;
}

interface LinhaObservacao {
  item_id: string;
  produto_canonico_id: string | null;
  descricao_original: string;
  ean: string | null;
  quantidade: number;
  unidade: string;
  valor_unitario: number;
  valor_total: number;
  desconto: number | null;
  loja_nome: string | null;
  observado_em: string;
}

function mapear(l: LinhaObservacao): ObservacaoLocal {
  return {
    itemId: l.item_id,
    produtoCanonicoId: l.produto_canonico_id,
    descricaoOriginal: l.descricao_original,
    ean: l.ean,
    quantidade: l.quantidade,
    unidade: l.unidade,
    valorUnitario: l.valor_unitario,
    valorTotal: l.valor_total,
    desconto: l.desconto,
    lojaNome: l.loja_nome,
    observadoEm: l.observado_em,
  };
}

const SELECT_OBSERVACOES = `
  SELECT
    i.id                  AS item_id,
    i.produto_canonico_id AS produto_canonico_id,
    i.descricao_original  AS descricao_original,
    i.ean                 AS ean,
    i.quantidade          AS quantidade,
    i.unidade             AS unidade,
    i.valor_unitario      AS valor_unitario,
    i.valor_total         AS valor_total,
    i.desconto            AS desconto,
    c.loja_nome           AS loja_nome,
    COALESCE(c.emitido_em, c.capturado_em) AS observado_em
  FROM item_cupom_local i
  JOIN cupom_local c ON c.id = i.cupom_local_id
`;

/** Todas as compras do usuário (base do catálogo e dos vereditos pessoais). */
export async function listarObservacoes(): Promise<ObservacaoLocal[]> {
  const linhas = await getBd().getAllAsync<LinhaObservacao>(
    `${SELECT_OBSERVACOES} ORDER BY observado_em DESC`,
  );
  return linhas.map(mapear);
}

/**
 * Compras de UM produto, casado por id canônico OU pelo EAN (caminho da
 * gôndola). Ordenadas da mais antiga p/ a mais recente — pronto p/ o gráfico de
 * evolução (C7.5).
 */
export async function listarObservacoesDoProduto(ref: {
  produtoCanonicoId?: string | null;
  ean?: string | null;
}): Promise<ObservacaoLocal[]> {
  const condicoes: string[] = [];
  const params: string[] = [];
  if (ref.produtoCanonicoId) {
    condicoes.push('i.produto_canonico_id = ?');
    params.push(ref.produtoCanonicoId);
  }
  if (ref.ean) {
    condicoes.push('i.ean = ?');
    params.push(ref.ean);
  }
  if (condicoes.length === 0) return [];

  const linhas = await getBd().getAllAsync<LinhaObservacao>(
    `${SELECT_OBSERVACOES} WHERE ${condicoes.join(' OR ')} ORDER BY observado_em ASC`,
    params,
  );
  return linhas.map(mapear);
}

/**
 * UF predominante do histórico (a mais recente com UF preenchida). É o recorte
 * geográfico para a consulta/sync regional — derivado da LOJA, nunca do usuário
 * (decisão travada). `null` quando ainda não há cupom processado com UF.
 */
export async function obterUfRecente(): Promise<string | null> {
  const linha = await getBd().getFirstAsync<{ uf: string | null }>(
    `SELECT uf FROM cupom_local
      WHERE uf IS NOT NULL
      ORDER BY capturado_em DESC
      LIMIT 1`,
  );
  return linha?.uf ?? null;
}

/** Ids canônicos distintos no histórico — alvos do delta sync de estatísticas. */
export async function listarProdutoCanonicoIds(): Promise<string[]> {
  const linhas = await getBd().getAllAsync<{ produto_canonico_id: string }>(
    `SELECT DISTINCT produto_canonico_id
       FROM item_cupom_local
      WHERE produto_canonico_id IS NOT NULL`,
  );
  return linhas.map((l) => l.produto_canonico_id);
}
