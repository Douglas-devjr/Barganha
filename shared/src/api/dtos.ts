/**
 * DTOs da API (contratos app ↔ backend). As semânticas exatas de cada endpoint
 * são refinadas nas camadas donas (ingestão em C2, consulta/sync em C4); aqui
 * fica a forma estável que ambos os lados consomem.
 */

import type { UnidadeBase } from '../core';
import type { PrecoEstatistica } from '../dominio/entidades';
import type { EscopoGeo, StatusCupom, StatusModeracao } from '../dominio/enums';

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
 * Ingestão por HTML (C2.6). Quando o portal da SEFAZ exige navegador/reCAPTCHA
 * (ex.: RJ), o app abre a nota num WebView no aparelho do usuário e envia o HTML
 * já renderizado. O parsing continua no backend (decisão travada nº2): o app só
 * entrega o HTML do cupom que ele já registrou por QR. A resposta é o próprio
 * `CupomResponse` atualizado (idealmente já `processado`, com os itens).
 */
export interface IngestaoHtmlRequest {
  html: string;
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
  /** Desconto total do cupom (R$), quando o portal informa (docs/06). */
  descontoTotal?: number;
  /** Valor efetivamente pago (R$) = soma dos itens − desconto total. */
  valorPago?: number;
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

/**
 * Resumo de exibição do produto (enriquecimento de curadoria, C11.5). Campos
 * humanos para a UI da gôndola; ausentes quando o produto ainda não foi
 * enriquecido (cai-se na `descricaoNormalizada` técnica).
 */
export interface ProdutoResumo {
  produtoCanonicoId: string;
  nomeExibicao?: string;
  marca?: string;
  categoria?: string;
  imagemUrl?: string;
  unidadeBase: UnidadeBase;
}

/** Estatística resolvida + o nível de escopo de fato usado no fallback. */
export interface ConsultaPrecoResponse {
  produtoCanonicoId: string;
  /** Escopo efetivamente atendido (loja→município→região→UF). */
  escopoResolvido: EscopoGeo;
  estatistica: PrecoEstatistica;
  /** Dados de exibição do produto, quando enriquecido (C11.5). */
  produto?: ProdutoResumo;
}

// ─────────────────── Enriquecimento de produto — curadoria (C11.5) ───────────

/**
 * Aplica enriquecimento humano a um produto canônico (nome/marca/categoria/foto).
 * Alvo por `produtoCanonicoId` OU `ean`. Não altera `descricaoNormalizada` nem o
 * casamento — só o que a UI mostra. Endpoint privilegiado (curadoria).
 */
export interface EnriquecimentoProdutoRequest {
  produtoCanonicoId?: string;
  ean?: string;
  nomeExibicao?: string;
  marca?: string;
  categoria?: string;
  imagemUrl?: string;
}

export interface EnriquecimentoProdutoResponse {
  produtoCanonicoId: string;
}

// ──────────────────── Lançamento manual de gôndola (C11.3) ───────────────────

/**
 * Lançamento MANUAL de preço (sem cupom): o usuário viu o preço na prateleira e
 * o informa. Exige conta (Bearer) — o `usuarioId` fica só no registro PRIVADO de
 * moderação (controle de abuso), NUNCA no pool. A geo é pela LOJA (CNPJ), nunca
 * pelo usuário (docs/04). v1 exige `ean` (o produto da prateleira escaneado).
 */
export interface LancamentoManualRequest {
  ean: string;
  descricao: string;
  /** Unidade de venda na prateleira (UN, KG, L…). Normalizada como num cupom. */
  unidade: string;
  /** Preço unitário visto na prateleira (R$). */
  valorUnitario: number;
  /** Loja onde o preço foi visto — chave da geo. */
  lojaCnpj: string;
  municipio?: string;
  uf?: string;
  /** Marca se o preço é promocional (entra como `emPromocao`, à parte do típico). */
  emPromocao?: boolean;
}

export interface LancamentoManualResponse {
  lancamentoId: string;
  status: StatusModeracao;
}

/** Item da fila de moderação, visto pela curadoria (C11.3). */
export interface LancamentoModeracaoResponse {
  id: string;
  ean: string;
  descricao: string;
  unidade: string;
  valorUnitario: number;
  lojaCnpj: string;
  municipio?: string;
  uf?: string;
  emPromocao: boolean;
  status: StatusModeracao;
  criadoEm: string;
}

/** Decisão da curadoria sobre um lançamento (aprovar publica no pool via gate). */
export interface DecisaoModeracaoRequest {
  decisao: 'aprovar' | 'rejeitar';
  /** Motivo (obrigatório ao rejeitar; ajuda auditoria). */
  motivo?: string;
}

export interface DecisaoModeracaoResponse {
  id: string;
  status: StatusModeracao;
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
