/**
 * Entidades do domínio v1 — representação TS das tabelas (supabase/migrations).
 * Datas como ISO 8601 (`string`) para trafegarem em JSON sem ambiguidade.
 *
 * Os dois mundos são tipados separadamente e NÃO se misturam (docs/04):
 *   • PRIVADO       : Usuario, Cupom, ItemCupom
 *   • COMPARTILHADO : Loja, ProdutoCanonico, ProdutoAlias, ObservacaoPreco,
 *                     PrecoEstatistica
 */

import type { UnidadeBase } from '../core';
import type { EscopoGeo, StatusCupom } from './enums';

// ─────────────────────────────── PRIVADO ───────────────────────────────

/** Conta do usuário. Mínima por design (sem nome/CPF). */
export interface Usuario {
  id: string;
  criadoEm: string;
}

/** Nota do usuário. `chaveAcesso` e `qrPayload` são privados — nunca ao pool. */
export interface Cupom {
  id: string;
  usuarioId: string;
  chaveAcesso?: string;
  lojaCnpj?: string;
  emitidoEm?: string;
  uf?: string;
  status: StatusCupom;
  qrPayload: string;
  criadoEm: string;
  atualizadoEm: string;
}

/** Item da nota do usuário (privado). `produtoCanonicoId` nulo até casar. */
export interface ItemCupom {
  id: string;
  cupomId: string;
  produtoCanonicoId?: string;
  descricaoOriginal: string;
  ean?: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
  desconto?: number;
}

// ──────────────────────────── COMPARTILHADO ────────────────────────────

/** Estabelecimento (chave da geo, via CNPJ). */
export interface Loja {
  cnpj: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  rede?: string;
  endereco?: string;
  municipio?: string;
  uf?: string;
  lat?: number;
  long?: number;
}

/**
 * Produto de referência para comparação. `descricaoNormalizada` é técnica (sem
 * acento, maiúsculas — base do casamento); `nomeExibicao`/`marca`/`categoria`/
 * `imagemUrl` são ENRIQUECIMENTO de curadoria (C11.5) para a UI mostrar um nome
 * amigável, a categoria e a foto, sem alterar o casamento.
 */
export interface ProdutoCanonico {
  id: string;
  ean?: string;
  descricaoNormalizada?: string;
  nomeExibicao?: string;
  marca?: string;
  categoria?: string;
  unidadeBase: UnidadeBase;
  imagemUrl?: string;
}

/** Mapeia descrições de cupom → canônico (casamento por texto, com confirmação). */
export interface ProdutoAlias {
  id: string;
  produtoCanonicoId: string;
  textoOriginal: string;
  confianca?: number;
  confirmado: boolean;
}

/**
 * Observação de preço ANÔNIMA e SOLTA — o coração compartilhado.
 * Por contrato, não tem (e nunca pode ganhar) `usuarioId`, `cupomId` nem
 * `chaveAcesso`. A criação passa SEMPRE pelo gate de anonimização (C1.4).
 */
export interface ObservacaoPreco {
  id: string;
  produtoCanonicoId: string;
  lojaCnpj: string;
  municipio?: string;
  uf?: string;
  precoNormalizado: number;
  unidadeBase: UnidadeBase;
  emPromocao: boolean;
  observadoEm: string;
}

/** Faixas agregadas por produto × escopo. Veredito usa mediana/percentis. */
export interface PrecoEstatistica {
  produtoCanonicoId: string;
  escopo: EscopoGeo;
  escopoId: string;
  unidadeBase: UnidadeBase;
  mediana?: number;
  p25?: number;
  p75?: number;
  minimo?: number;
  maximo?: number;
  /** Menor preço promocional visto — exibido à parte, nunca no típico. */
  menorPromocional?: number;
  nObservacoes: number;
  atualizadoEm: string;
}
