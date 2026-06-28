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
    atualizadoEm: l.atualizado_em,
  };
}

/** Upsert do delta sync. Substitui a linha (PK produto×escopo×escopoId×unidade). */
export async function salvarEstatisticas(estatisticas: PrecoEstatistica[]): Promise<void> {
  if (estatisticas.length === 0) return;
  const db = getBd();
  await db.withTransactionAsync(async () => {
    for (const e of estatisticas) {
      await db.runAsync(
        `INSERT OR REPLACE INTO cache_estatistica
           (produto_canonico_id, escopo, escopo_id, unidade_base, mediana, p25, p75,
            minimo, maximo, menor_promocional, n_observacoes, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          e.atualizadoEm,
        ],
      );
    }
  });
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

/** Faixa exata de um produto num escopo. */
export async function obterEstatistica(
  produtoCanonicoId: string,
  escopo: EscopoGeo,
  escopoId: string,
  unidadeBase: UnidadeBase,
): Promise<CacheEstatistica | null> {
  const linha = await getBd().getFirstAsync<LinhaCache>(
    `SELECT * FROM cache_estatistica
      WHERE produto_canonico_id = ? AND escopo = ? AND escopo_id = ? AND unidade_base = ?`,
    [produtoCanonicoId, escopo, escopoId, unidadeBase],
  );
  return linha ? mapear(linha) : null;
}

/** Quantidade de linhas em cache (diagnóstico / "X produtos no seu cache"). */
export async function contarEstatisticas(): Promise<number> {
  const linha = await getBd().getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM cache_estatistica`,
  );
  return linha?.total ?? 0;
}
