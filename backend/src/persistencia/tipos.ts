/**
 * Portas de persistência da captura (C2). Implementadas pelo Supabase
 * (produção) e por um adaptador em memória (testes/dev). Mantêm o domínio
 * independente do banco.
 *
 * A separação privado/compartilhado é respeitada na própria assinatura:
 * `marcarProcessado` recebe `itensPrivados` (→ item_cupom) e `observacoes`
 * já do tipo `ObservacaoAnonima` (→ observacao_preco). Só o gate produz esse
 * tipo, então não há caminho de escrita no pool que burle a anonimização.
 */

import type { NotaEstruturada, ObservacaoAnonima, StatusCupom } from '@barganha/shared';

import type { ItemCupomNovo } from '../anonimizacao/anonimizador';

/** Dados de uma ingestão de QR (lado privado). */
export interface DadosIngestao {
  usuarioId: string;
  chaveAcesso?: string;
  uf?: string;
  qrPayload: string;
  /** Quando o app capturou o QR (ISO 8601). */
  capturadoEm: string;
}

export interface ResultadoIngestao {
  cupomId: string;
  status: StatusCupom;
  /** `false` quando o cupom já existia (idempotência por chave). */
  novo: boolean;
}

/** Visão mínima do cupom necessária para processá-lo. */
export interface CupomRegistro {
  id: string;
  usuarioId: string;
  uf?: string;
  chaveAcesso?: string;
  qrPayload: string;
  status: StatusCupom;
}

/** Resultado da anonimização pronto para persistir (privado + pool). */
export interface DadosNotaProcessada {
  loja: NotaEstruturada['loja'];
  emitidoEm: string;
  uf: string;
  itensPrivados: ItemCupomNovo[];
  observacoes: ObservacaoAnonima[];
}

export interface FiltroReprocessamento {
  /** Restringe a uma UF (ex.: parser novo entrou no ar). */
  uf?: string;
  /** Status elegíveis (ex.: `qr_capturado` e `falha`). */
  status: StatusCupom[];
  limite?: number;
}

export interface RepositorioCupom {
  /** Insere o cupom (status `qr_capturado`) de forma idempotente pela chave. */
  criarOuObterPorChave(dados: DadosIngestao): Promise<ResultadoIngestao>;
  /** Carrega o cupom para processamento, ou `undefined` se não existir. */
  obterParaProcessamento(cupomId: string): Promise<CupomRegistro | undefined>;
  /** Grava nota privada + pool anônimo e marca o cupom como `processado`. */
  marcarProcessado(cupomId: string, dados: DadosNotaProcessada): Promise<void>;
  /** Marca o cupom como `falha` (erro permanente de parsing). */
  marcarFalha(cupomId: string, motivo?: string): Promise<void>;
  /** Lista ids de cupons elegíveis a reprocessamento (C2.5). */
  listarParaReprocessar(filtro: FiltroReprocessamento): Promise<string[]>;
}
