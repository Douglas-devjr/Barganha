/**
 * Enumerações do domínio — espelham os tipos enum do Postgres (baseline C0.4).
 * Mantenha em sincronia com supabase/migrations.
 */

/** Ciclo de vida de um cupom (espelha o enum `status_cupom`). */
export const STATUS_CUPOM = ['qr_capturado', 'processado', 'falha'] as const;
export type StatusCupom = (typeof STATUS_CUPOM)[number];

/**
 * Escopo geográfico das estatísticas (espelha o enum `escopo_geo`).
 * Ordem do fallback hierárquico: loja → município → região → UF (docs/06).
 */
export const ESCOPO_GEO = ['loja', 'municipio', 'regiao', 'uf'] as const;
export type EscopoGeo = (typeof ESCOPO_GEO)[number];

/**
 * Ciclo de moderação de um lançamento MANUAL de gôndola (C11.3 — espelha o enum
 * `status_moderacao`). Lançamentos manuais não vêm de NFC-e verificada, então
 * passam por curadoria antes de virar `observacao_preco` no pool anônimo.
 */
export const STATUS_MODERACAO = ['pendente', 'aprovado', 'rejeitado'] as const;
export type StatusModeracao = (typeof STATUS_MODERACAO)[number];
