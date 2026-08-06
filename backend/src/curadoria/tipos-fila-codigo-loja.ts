/**
 * C3.6.2 — Portas de persistência da FILA de códigos-loja suspeitos.
 *
 * `produto_codigo_loja` com `status <> 'ativo'` é o que `avaliarMapeamento`
 * (resolvedor-produto.ts) recusou: unidade divergente é veto duro (nunca chega
 * aqui — o mapeamento nem é marcado), mas descrição na faixa de dúvida (com ou
 * sem salto de preço) e dormência por falta de uso SÃO marcadas e ficam
 * esperando um humano. Até esta etapa não havia NENHUMA tela para essa fila —
 * as linhas só se acumulavam (`produto_codigo_loja_suspeito_idx` existia sem
 * nada que o lesse).
 *
 * Fica em `curadoria/` (não em `anonimizacao/casamento.ts`) porque estas portas
 * são de LEITURA/DECISÃO humana sobre o mapeamento, não de resolução — o mesmo
 * corte que separa `RepositorioFusao` do `MapaCodigoLoja`.
 */

import type { UnidadeBase } from '@barganha/shared';

/** Resumo do canônico que o mapeamento aponta HOJE — contexto para o curador. */
export interface ProdutoCanonicoResumoFila {
  id: string;
  ean?: string;
  nomeExibicao?: string;
  descricaoNormalizada: string;
}

/** Uma linha suspeita/dormente, já com o contexto que o curador precisa ver. */
export interface ItemFilaCodigoLoja {
  lojaCnpj: string;
  lojaRazaoSocial?: string;
  lojaNomeFantasia?: string;
  codigo: string;
  descricaoReferencia: string;
  unidadeBase: UnidadeBase;
  status: 'suspeito' | 'dormente';
  motivoSuspeita?: string;
  hits: number;
  ultimoVisto: string;
  atualizadoEm: string;
  produtoCanonico: ProdutoCanonicoResumoFila;
}

/** Por que `reapontar` não aconteceu — ver `ServicoFilaCodigoLoja.reapontar`. */
export type ResultadoReaponte =
  'ok' | 'nao_encontrado' | 'produto_nao_encontrado' | 'unidade_divergente';

export interface RepositorioFilaCodigoLoja {
  /** Fila: `status <> 'ativo'`, mais recentemente alteradas primeiro (o que pediu atenção por último). */
  listarSuspeitos(limite: number): Promise<ItemFilaCodigoLoja[]>;
  /**
   * Confirma o mapeamento como estava: volta a `ativo`, mantém o
   * `produto_canonico_id` atual. `false` = o par (loja, código) não existe.
   */
  confirmarMapeamento(lojaCnpj: string, codigo: string): Promise<boolean>;
  /**
   * Reaponta para outro canônico e reabilita (`status = 'ativo'`). Recusa
   * (sem escrever nada) quando o alvo não existe ou tem unidade-base diferente
   * da do mapeamento — o mesmo veto de integridade que a fusão de canônicos
   * aplica, pelo mesmo motivo: misturar kg com un não tem conserto depois.
   */
  reapontarMapeamento(
    lojaCnpj: string,
    codigo: string,
    produtoCanonicoId: string,
  ): Promise<ResultadoReaponte>;
}
