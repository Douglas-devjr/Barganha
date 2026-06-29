/**
 * C11.3 — Portas de persistência do lançamento manual de gôndola + moderação.
 *
 * O registro é PRIVADO (carrega `usuarioId` para anti-abuso) e vive separado do
 * pool. Só a APROVAÇÃO publica no pool, e mesmo assim pela `ObservacaoAnonima`
 * (tipo que só o gate de `@barganha/shared` produz) — então não há caminho de
 * escrita no pool que burle a anonimização, igual à ingestão de cupom (C2.4).
 *
 * A visão de curadoria (`LancamentoModeracaoRegistro`) NÃO expõe `usuarioId`:
 * o moderador decide pelo conteúdo (preço/loja), não por quem lançou.
 */

import type { ObservacaoAnonima, StatusModeracao } from '@barganha/shared';

/** Novo lançamento manual a registrar (lado PRIVADO — tem o autor). */
export interface LancamentoModeracaoNovo {
  usuarioId: string;
  ean: string;
  descricao: string;
  unidade: string;
  valorUnitario: number;
  lojaCnpj: string;
  municipio?: string;
  uf?: string;
  emPromocao: boolean;
}

/** Lançamento visto pela CURADORIA — sem `usuarioId` (anti-abuso fica no banco). */
export interface LancamentoModeracaoRegistro {
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

/** Loja-alvo da publicação (geo via CNPJ). Upsert mínimo na aprovação. */
export interface LojaModeracao {
  cnpj: string;
  municipio?: string;
  uf?: string;
}

export interface RepositorioModeracao {
  /** Registra o lançamento como `pendente` e devolve o id. */
  criar(dados: LancamentoModeracaoNovo): Promise<string>;
  /** Fila de curadoria: os `pendente`, mais antigos primeiro. */
  listarPendentes(limite?: number): Promise<LancamentoModeracaoRegistro[]>;
  /** Carrega um lançamento (qualquer status), ou `undefined` se não existir. */
  obter(id: string): Promise<LancamentoModeracaoRegistro | undefined>;
  /** Marca como `rejeitado` com o motivo (não publica nada). */
  rejeitar(id: string, motivo?: string): Promise<void>;
  /**
   * Aprova ATOMICAMENTE: transiciona `pendente`→`aprovado` e SÓ ENTÃO publica a
   * observação no pool (loja upsert + `observacao_preco`). Idempotente — se já
   * decidido, não republica (o pool é append-only, sem deduplicação posterior).
   */
  aprovar(id: string, loja: LojaModeracao, observacao: ObservacaoAnonima): Promise<void>;
}
