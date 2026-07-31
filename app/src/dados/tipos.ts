/**
 * C5.3 — Tipos das linhas do SQLite local. São o espelho OFFLINE do lado privado
 * (docs/05) + o cache de estatísticas. Distinguem-se dos tipos de domínio de
 * @barganha/shared porque carregam estado local de sincronização (id local,
 * id de servidor, status de upload).
 */

import type { StatusCupom, TipicoNaCompra, UnidadeBase, EscopoGeo } from '@barganha/shared';

/** Cupom no dispositivo. `id` é local (gerarIdLocal); `cupomIdServidor` chega
 * após a ingestão. `qrPayload` é privado e nunca vai ao pool (docs/04). */
export interface CupomLocal {
  id: string;
  cupomIdServidor: string | null;
  qrPayload: string;
  chaveAcesso: string | null;
  capturadoEm: string;
  status: StatusCupom;
  lojaCnpj: string | null;
  lojaNome: string | null;
  /** Município da LOJA (nunca do usuário) — recorte regional das comparações. */
  lojaMunicipio: string | null;
  emitidoEm: string | null;
  uf: string | null;
  /** Desconto total do cupom (R$), quando o portal informa (C2.6). */
  descontoTotal: number | null;
  /** Valor efetivamente pago (R$) = soma dos itens − desconto total. */
  valorPago: number | null;
  criadoEm: string;
  atualizadoEm: string;
}

/** Item de um cupom local (privado), preenchido quando a nota é processada. */
export interface ItemCupomLocal {
  id: string;
  cupomLocalId: string;
  produtoCanonicoId: string | null;
  descricaoOriginal: string;
  ean: string | null;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
  desconto: number | null;
  /**
   * Típico da região CONGELADO no processamento deste cupom (ver
   * `TipicoNaCompra` em @barganha/shared). Vem pronto do backend; o app nunca
   * recalcula — é o que mantém números do passado estáveis e offline.
   *
   * `null` quando o item não casou com produto canônico ou a região não tinha
   * base na época. Hoje é o caso da maioria (pool raso) e é o correto: sem
   * base, o app não afirma nada.
   */
  tipicoNaCompra: TipicoNaCompra | null;
}

/**
 * Um cupom vindo do servidor para reidratar o espelho local no login (restore,
 * docs/04). Espelha o DTO `HistoricoCupom` com os nomes locais; `qrPayload` volta
 * porque o espelho local o exige (NOT NULL) e ele é a base do reprocessamento
 * retroativo (decisão travada nº2). É dado do próprio dono — nunca toca o pool.
 */
export interface CupomRestaurado {
  cupomIdServidor: string;
  status: StatusCupom;
  qrPayload: string;
  chaveAcesso?: string | null;
  capturadoEm: string;
  emitidoEm?: string | null;
  uf?: string | null;
  lojaCnpj?: string | null;
  lojaNome?: string | null;
  lojaMunicipio?: string | null;
  descontoTotal?: number | null;
  valorPago?: number | null;
  itens: Omit<ItemCupomLocal, 'id' | 'cupomLocalId'>[];
}

/** Linha do cache de `preco_estatistica` baixada via delta sync (docs/05). */
export interface CacheEstatistica {
  produtoCanonicoId: string;
  escopo: EscopoGeo;
  escopoId: string;
  unidadeBase: UnidadeBase;
  mediana: number | null;
  p25: number | null;
  p75: number | null;
  minimo: number | null;
  maximo: number | null;
  menorPromocional: number | null;
  nObservacoes: number;
  /**
   * Data da observação mais recente por trás da mediana — a idade do PREÇO.
   * `null` nas linhas em cache antes da coluna existir (v10): leia como idade
   * DESCONHECIDA, nunca como recente.
   *
   * Não confundir com `atualizadoEm`, que é quando o SERVIDOR recalculou: um
   * recálculo completo carimba hoje em dado de meses atrás.
   */
  observadoEmMaisRecente: string | null;
  atualizadoEm: string;
}

/**
 * Linha do cache de catálogo (C4.5) — os dados de EXIBIÇÃO do produto, baixados
 * por `POST /sync/produtos`. É o que dá nome, offline, ao id que o cache de
 * estatística conhece só pelo preço.
 *
 * Campos de curadoria (C11.5) são `null` enquanto o produto não foi enriquecido
 * no servidor; a `unidadeBase` vem sempre (é do catálogo, não da curadoria).
 */
export interface CacheProduto {
  produtoCanonicoId: string;
  nomeExibicao: string | null;
  marca: string | null;
  categoria: string | null;
  imagemUrl: string | null;
  unidadeBase: UnidadeBase;
  /** Quando ESTE aparelho baixou o resumo — base da revalidação. */
  atualizadoEm: string;
}

/** Item da fila de upload (C6.2). Idempotência real por `chave_acesso` no
 * backend; aqui guardamos o estado de retry. */
export interface ItemFilaUpload {
  cupomLocalId: string;
  tentativas: number;
  ultimaTentativaEm: string | null;
  proximaTentativaEm: string | null;
  ultimoErro: string | null;
  criadoEm: string;
}
