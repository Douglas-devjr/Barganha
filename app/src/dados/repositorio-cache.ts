/**
 * C5.3 — Cache local de `preco_estatistica` (docs/05). É só-leitura derivada do
 * servidor: o delta sync grava aqui (`salvarEstatisticas`) e a consulta na
 * gôndola lê daqui (offline-first). Conflito é mínimo — o servidor é a verdade.
 *
 * C4.5 — no fim do arquivo mora o cache de CATÁLOGO (`cache_produto`): o mesmo
 * princípio, para o outro lado do produto. Um guarda quanto custa; o outro, como
 * ele se chama.
 */

import type { EscopoGeo, PrecoEstatistica, ProdutoResumo, UnidadeBase } from '@barganha/shared';

import { getBd } from './bd';
import type { CacheEstatistica, CacheProduto } from './tipos';

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
 *
 * `cache_produto` NÃO sai junto de propósito: nome, marca e categoria não têm
 * recorte geográfico — o arroz não muda de nome ao mudar de cidade — e apagá-los
 * deixaria o catálogo mudo até o próximo sync de rede, justo em quem acabou de
 * viajar (que é quando o app costuma estar sem sinal).
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

/** Ids de produto que têm alguma linha de estatística em cache (alvos da C4.5). */
export async function listarProdutoCanonicoIds(): Promise<string[]> {
  const linhas = await getBd().getAllAsync<{ produto_canonico_id: string }>(
    `SELECT DISTINCT produto_canonico_id FROM cache_estatistica`,
  );
  return linhas.map((l) => l.produto_canonico_id);
}

// ───────────────────────── Cache de catálogo (C4.5) ─────────────────────────

interface LinhaCacheProduto {
  produto_canonico_id: string;
  nome_exibicao: string | null;
  marca: string | null;
  categoria: string | null;
  imagem_url: string | null;
  unidade_base: string;
  atualizado_em: string;
}

function mapearProduto(l: LinhaCacheProduto): CacheProduto {
  return {
    produtoCanonicoId: l.produto_canonico_id,
    nomeExibicao: l.nome_exibicao,
    marca: l.marca,
    categoria: l.categoria,
    imagemUrl: l.imagem_url,
    unidadeBase: l.unidade_base as UnidadeBase,
    atualizadoEm: l.atualizado_em,
  };
}

/**
 * Upsert dos resumos vindos de `POST /sync/produtos`. Substitui a linha inteira:
 * o servidor é a verdade, e um campo que a curadoria APAGOU lá tem de sumir aqui
 * também (um update parcial deixaria um nome revogado vivo no aparelho).
 */
export async function salvarResumos(resumos: readonly ProdutoResumo[]): Promise<void> {
  if (resumos.length === 0) return;
  const agora = new Date().toISOString();
  const db = getBd();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const r of resumos) {
      await txn.runAsync(
        `INSERT OR REPLACE INTO cache_produto
           (produto_canonico_id, nome_exibicao, marca, categoria, imagem_url,
            unidade_base, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          r.produtoCanonicoId,
          r.nomeExibicao ?? null,
          r.marca ?? null,
          r.categoria ?? null,
          r.imagemUrl ?? null,
          r.unidadeBase,
          agora,
        ],
      );
    }
  });
}

/** Todos os resumos em cache, por id — a forma que as telas consomem. */
export async function mapaDeResumos(): Promise<Map<string, CacheProduto>> {
  const linhas = await getBd().getAllAsync<LinhaCacheProduto>(`SELECT * FROM cache_produto`);
  return new Map(linhas.map((l) => [l.produto_canonico_id, mapearProduto(l)]));
}

/** Resumo de UM produto (tela Detalhe). `null` quando ainda não foi baixado. */
export async function obterResumo(produtoCanonicoId: string): Promise<CacheProduto | null> {
  const linha = await getBd().getFirstAsync<LinhaCacheProduto>(
    `SELECT * FROM cache_produto WHERE produto_canonico_id = ?`,
    [produtoCanonicoId],
  );
  return linha ? mapearProduto(linha) : null;
}

/**
 * Dos ids pedidos, os que o sync de catálogo precisa buscar: os que nunca foram
 * baixados e os baixados antes de `corteIso`.
 *
 * A revalidação existe porque a curadoria (C11.5) enriquece produto DEPOIS: um
 * resumo baixado hoje sem `nomeExibicao` ficaria sem nome para sempre se só
 * buscássemos o que falta. Ordem de saída: os que faltam primeiro — em lote
 * cortado pelo teto do servidor, quem nunca teve nome tem mais a ganhar do que
 * quem só está desatualizado.
 */
export async function idsParaResumo(
  produtoCanonicoIds: readonly string[],
  corteIso: string,
): Promise<string[]> {
  if (produtoCanonicoIds.length === 0) return [];
  const marcadores = produtoCanonicoIds.map(() => '?').join(', ');
  const linhas = await getBd().getAllAsync<{ produto_canonico_id: string; atualizado_em: string }>(
    `SELECT produto_canonico_id, atualizado_em
       FROM cache_produto
      WHERE produto_canonico_id IN (${marcadores})`,
    [...produtoCanonicoIds],
  );
  const baixadoEm = new Map(linhas.map((l) => [l.produto_canonico_id, l.atualizado_em]));
  const faltando = produtoCanonicoIds.filter((id) => !baixadoEm.has(id));
  const vencidos = produtoCanonicoIds.filter((id) => {
    const em = baixadoEm.get(id);
    return em != null && em < corteIso;
  });
  return [...faltando, ...vencidos];
}
