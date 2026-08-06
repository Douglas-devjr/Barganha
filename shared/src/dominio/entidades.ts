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

/**
 * SNAPSHOT do típico da região no instante em que a compra foi processada.
 *
 * Por que congelar em vez de calcular depois: a mediana de hoje não é a de
 * julho. Comparar uma compra antiga com o pool atual transforma inflação em
 * "economia" (ou em prejuízo) fantasma, e faz o número do usuário mudar sozinho
 * a cada sincronização. Como a série histórica de `preco_estatistica` não é
 * guardada, este valor é IRRECUPERÁVEL depois — a mesma razão de guardar o QR
 * cru desde o dia 1 (decisão travada nº2).
 *
 * A mediana é lida ANTES de o cupom entrar no pool: a base é o típico de antes
 * da própria compra do usuário, que não se auto-referencia.
 *
 * `mediana` é R$/`unidadeBase` (nunca valor cru — decisão travada nº5) e vem da
 * faixa REGULAR, nunca de `menorPromocional` (docs/06). `nObservacoes` viaja
 * junto porque quem for exibir precisa decidir se a base é grande o bastante —
 * a captura é fiel, o filtro é da UI.
 */
export interface TipicoNaCompra {
  mediana: number;
  unidadeBase: UnidadeBase;
  /** Nível geográfico de onde a mediana veio (`municipio`, `regiao` ou `uf`). */
  escopo: EscopoGeo;
  nObservacoes: number;
}

/** Item da nota do usuário (privado). `produtoCanonicoId` nulo até casar. */
export interface ItemCupom {
  id: string;
  cupomId: string;
  produtoCanonicoId?: string;
  descricaoOriginal: string;
  ean?: string;
  /**
   * Código INTERNO do item na loja (SKU), preservado do parser SÓ quando o
   * código da nota NÃO é um EAN válido (ver `ItemEstruturado.codigoLoja`,
   * shared/dominio/nota-estruturada.ts, para o porquê e a evidência). PRIVADO
   * como o resto de `item_cupom` — nunca cruza para o pool compartilhado; não é
   * dado pessoal (é SKU da LOJA, não do consumidor), mas ainda sem modelagem no
   * lado anônimo (produto_alias hoje só conhece `textoOriginal`).
   */
  codigoLoja?: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
  desconto?: number;
  /**
   * Típico da região no momento da compra. Ausente quando o item não casou com
   * produto canônico ou o pool ainda não tinha base na região — é o caso comum
   * hoje, e é o correto: sem base, não se afirma nada.
   */
  tipicoNaCompra?: TipicoNaCompra;
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

/**
 * Linha de `preco_estatistica` (faixa por produto × escopo), na forma como ela
 * chega de uma leitura direta de banco: números ausentes são SQL `NULL` (`|
 * null`), não campo faltando (`?:`). É o formato comum entre o cache offline do
 * app (`CacheEstatistica`, app/src/dados/tipos.ts) e o job de alerta de preço no
 * backend (C8.4, jobs/alerta-preco.ts) — as regras puras de alerta
 * (`alertas-regras.ts`) precisam do MESMO shape dos dois lados; duas cópias
 * divergiriam cedo ou tarde na mesma histerese/frescor.
 *
 * Difere de `PrecoEstatistica` (usa `?: number`, pensado para o DTO de API, onde
 * ausência = campo omitido no JSON) só na nulidade — o conteúdo é o mesmo.
 */
export interface EstatisticaRegional {
  produtoCanonicoId: string;
  escopo: EscopoGeo;
  escopoId: string;
  unidadeBase: UnidadeBase;
  mediana: number | null;
  p25: number | null;
  p75: number | null;
  minimo: number | null;
  maximo: number | null;
  /** Menor preço promocional visto — exibido à parte, nunca no típico. */
  menorPromocional: number | null;
  nObservacoes: number;
  /**
   * `observado_em_max` — a observação regular mais recente que sustenta a
   * mediana (a idade do PREÇO). `null` = idade DESCONHECIDA, nunca "recente"
   * (ver `dadoRecente` em `estatistica/frescor.ts`).
   */
  observadoEmMaisRecente: string | null;
  atualizadoEm: string;
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
  /**
   * `observado_em` da observação regular mais recente que sustenta a mediana —
   * a idade do PREÇO. Diferente de `atualizadoEm`, que é a do RECÁLCULO e vira
   * "agora" em toda varredura geral (deploy, recalibração), fazendo dado velho
   * parecer novo. Ausente nas linhas anteriores à coluna: leia como idade
   * DESCONHECIDA, nunca como recente.
   */
  observadoEmMaisRecente?: string;
  atualizadoEm: string;
}
