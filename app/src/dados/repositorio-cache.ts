/**
 * C5.3 — Cache local de `preco_estatistica` (docs/05). É só-leitura derivada do
 * servidor: o delta sync grava aqui (`salvarEstatisticas`) e a consulta na
 * gôndola lê daqui (offline-first). Conflito é mínimo — o servidor é a verdade.
 */

import type { EscopoGeo, PrecoEstatistica, UnidadeBase } from '@barganha/shared';

import { getBd } from './bd';
import type { CacheEstatistica } from './tipos';

interface LinhaCache {
  produto_canonico_id: string;
  escopo: string;
  escopo_id: string;
  unidade_base: string;
  mediana: number | null;
  p25: number | null;
  p75: number | null;
  minimo: number | null;
  maximo: number | null;
  menor_promocional: number | null;
  n_observacoes: number;
  observado_em_max: string | null;
  atualizado_em: string;
}

function mapear(l: LinhaCache): CacheEstatistica {
  return {
    produtoCanonicoId: l.produto_canonico_id,
    escopo: l.escopo as EscopoGeo,
    escopoId: l.escopo_id,
    unidadeBase: l.unidade_base as UnidadeBase,
    mediana: l.mediana,
    p25: l.p25,
    p75: l.p75,
    minimo: l.minimo,
    maximo: l.maximo,
    menorPromocional: l.menor_promocional,
    nObservacoes: l.n_observacoes,
    // `?? null` e não `!`: linha gravada antes da v10 vem sem a coluna.
    observadoEmMaisRecente: l.observado_em_max ?? null,
    atualizadoEm: l.atualizado_em,
  };
}

/** Upsert do delta sync. Substitui a linha (PK produto×escopo×escopoId×unidade). */
export async function salvarEstatisticas(estatisticas: PrecoEstatistica[]): Promise<void> {
  if (estatisticas.length === 0) return;
  const db = getBd();
  // Exclusiva: o delta sync grava página a página enquanto a UI lê o cache.
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const e of estatisticas) {
      await txn.runAsync(
        `INSERT OR REPLACE INTO cache_estatistica
           (produto_canonico_id, escopo, escopo_id, unidade_base, mediana, p25, p75,
            minimo, maximo, menor_promocional, n_observacoes, observado_em_max,
            atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.produtoCanonicoId,
          e.escopo,
          e.escopoId,
          e.unidadeBase,
          e.mediana ?? null,
          e.p25 ?? null,
          e.p75 ?? null,
          e.minimo ?? null,
          e.maximo ?? null,
          e.menorPromocional ?? null,
          e.nObservacoes,
          // Backend anterior a esta coluna não manda o campo — fica nulo, e a UI
          // diz "sem data" em vez de fingir frescor.
          e.observadoEmMaisRecente ?? null,
          e.atualizadoEm,
        ],
      );
    }
  });
}

/**
 * Zera o cache de estatísticas. Usado ao TROCAR a região: o recorte geográfico
 * muda, então as linhas do recorte anterior deixam de valer e o próximo sync
 * repopula do zero (cursor também é resetado).
 */
export async function limpar(): Promise<void> {
  await getBd().runAsync(`DELETE FROM cache_estatistica`);
}

/**
 * Dos ids pedidos, os que NÃO têm nenhuma linha em cache (C7.7).
 *
 * Existe por causa do cursor do delta: ele avança sobre o que foi ENTREGUE, e um
 * produto que entra no recorte depois (item novo na lista, vindo do catálogo
 * regional) tem estatística mais ANTIGA que o cursor — o delta incremental nunca
 * a traria. Estes ids precisam de uma busca sem cursor, do começo.
 */
export async function idsSemEstatistica(produtoCanonicoIds: readonly string[]): Promise<string[]> {
  if (produtoCanonicoIds.length === 0) return [];
  const marcadores = produtoCanonicoIds.map(() => '?').join(', ');
  const linhas = await getBd().getAllAsync<{ produto_canonico_id: string }>(
    `SELECT DISTINCT produto_canonico_id
       FROM cache_estatistica
      WHERE produto_canonico_id IN (${marcadores})`,
    [...produtoCanonicoIds],
  );
  const comCache = new Set(linhas.map((l) => l.produto_canonico_id));
  return produtoCanonicoIds.filter((id) => !comCache.has(id));
}

/** Todas as faixas em cache de um produto (vários escopos). Base do veredito (C7). */
export async function listarEstatisticasDoProduto(
  produtoCanonicoId: string,
): Promise<CacheEstatistica[]> {
  const linhas = await getBd().getAllAsync<LinhaCache>(
    `SELECT * FROM cache_estatistica WHERE produto_canonico_id = ?`,
    [produtoCanonicoId],
  );
  return linhas.map(mapear);
}
