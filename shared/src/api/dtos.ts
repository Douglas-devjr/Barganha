/**
 * DTOs da API (contratos app ↔ backend). As semânticas exatas de cada endpoint
 * são refinadas nas camadas donas (ingestão em C2, consulta/sync em C4); aqui
 * fica a forma estável que ambos os lados consomem.
 */

import type { PrecoEstatistica } from '../dominio/entidades';
import type { EscopoGeo, StatusCupom } from '../dominio/enums';

// ─────────────────────────── Ingestão (C2.1) ───────────────────────────

/** App envia só o QR cru; o parsing roda no backend (nunca no app). */
export interface IngestaoQrRequest {
  qrPayload: string;
  /** Quando o app capturou o QR (ISO 8601) — offline-first. */
  capturadoEm: string;
}

export interface IngestaoQrResponse {
  cupomId: string;
  status: StatusCupom;
}

/**
 * Item de uma nota já processada, devolvido ao DONO do cupom (lado privado).
 * Espelha `ItemCupom` sem os ids internos — o app guarda no espelho local.
 */
export interface ItemNotaResponse {
  produtoCanonicoId?: string;
  descricaoOriginal: string;
  ean?: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
  desconto?: number;
}

/**
 * Estado de um cupom do próprio usuário (C6.3). A ingestão é assíncrona (202 +
 * fila), então o app consulta este recurso PRIVADO (Bearer, escopo do dono) para
 * acompanhar o parsing e exibir os itens quando `status = 'processado'`.
 *
 * É lado PRIVADO de ponta a ponta: só o dono lê, nunca toca o pool anônimo
 * (docs/04). `loja` é a referência mínima para o cabeçalho da nota.
 */
export interface CupomResponse {
  cupomId: string;
  status: StatusCupom;
  emitidoEm?: string;
  uf?: string;
  loja?: {
    cnpj: string;
    razaoSocial?: string;
    nomeFantasia?: string;
    municipio?: string;
    uf?: string;
  };
  itens: ItemNotaResponse[];
}

// ───────────────────────────── Conta (C4.3) ─────────────────────────────

/**
 * Conta anônima. Sem nome/CPF (minimização LGPD, docs/04). O `usuarioId` é a
 * credencial que o app guarda e envia como `Authorization: Bearer <id>` nos
 * endpoints privados (ingestão). Consulta e delta sync são anônimos (lêem só o
 * pool compartilhado) e NÃO exigem conta.
 */
export interface ContaAnonimaResponse {
  usuarioId: string;
}

// ───────────────────────── Consulta veredito (C4.1) ─────────────────────

/** Entrada na gôndola: EAN (principal) ou nome (fallback) + recorte geo. */
export interface ConsultaPrecoRequest {
  ean?: string;
  nome?: string;
  municipio?: string;
  uf?: string;
}

/** Estatística resolvida + o nível de escopo de fato usado no fallback. */
export interface ConsultaPrecoResponse {
  produtoCanonicoId: string;
  /** Escopo efetivamente atendido (loja→município→região→UF). */
  escopoResolvido: EscopoGeo;
  estatistica: PrecoEstatistica;
}

// ───────────────────────────── Delta sync (C4.2) ───────────────────────

/** Baixa só o que mudou desde o cursor, no escopo da região/produtos. */
export interface DeltaSyncRequest {
  /** Cursor = maior `atualizado_em` recebido (ISO 8601); ausente = sync inicial. */
  cursor?: string;
  /**
   * Chaves de `escopo_id` do recorte geográfico do usuário. Apesar do nome,
   * aceita os DOIS níveis úteis ao fallback offline: `UF:Município` E o código
   * de `UF`. Inclua ambos (ex.: `["RJ:Rio de Janeiro", "RJ"]`) para o cache ter
   * a linha de UF quando o município tiver poucos dados.
   */
  municipios?: string[];
  /** Produtos do histórico para manter no cache. */
  produtoCanonicoIds?: string[];
}

export interface DeltaSyncResponse {
  estatisticas: PrecoEstatistica[];
  /** Novo cursor para a próxima sincronização. */
  cursor: string;
}
