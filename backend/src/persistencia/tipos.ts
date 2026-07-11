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

import type { NotaEstruturada, ObservacaoAnonima, StatusCupom, TotaisNota } from '@barganha/shared';

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
  /**
   * Totais do cupom (bruto/desconto/pago), quando o portal os fornece. São
   * persistidos no CUPOM (lado privado) para o app exibir o desconto também no
   * caminho servidor — não só na ingestão por HTML (C2.6).
   */
  total?: TotaisNota;
}

/**
 * Visão privada de um cupom já processado para devolver ao DONO (C6.3). Inclui o
 * cabeçalho + itens; a `loja` é a referência mínima (vinda do pool, mas só lida
 * para compor a nota do próprio usuário). Nunca cruza para o lado compartilhado.
 */
export interface CupomComItens {
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
  itens: ItemCupomNovo[];
  /** Desconto total do cupom (R$), quando o portal informa. */
  descontoTotal?: number;
  /** Valor efetivamente pago (R$) = bruto − desconto. */
  valorPago?: number;
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
  /**
   * Cupom + itens do PRÓPRIO usuário (C6.3). Restringe por `usuarioId` (gate de
   * acesso): de outro dono ou inexistente → `undefined` (não vaza existência).
   */
  obterDoUsuario(cupomId: string, usuarioId: string): Promise<CupomComItens | undefined>;
  /**
   * Grava nota privada + pool anônimo e marca o cupom como `processado`.
   * Cupom JÁ `processado` é no-op (trava anti-corrida: fila × ingestão por
   * HTML não podem duplicar o pool). `sobrescreverProcessado` é a exceção
   * DELIBERADA do backfill (job:republicar), que reescreve um processado —
   * ele traz a própria guarda anti-duplicação (só cupons sem canônico algum).
   */
  marcarProcessado(
    cupomId: string,
    dados: DadosNotaProcessada,
    opcoes?: { sobrescreverProcessado?: boolean },
  ): Promise<void>;
  /** Marca o cupom como `falha` (erro permanente de parsing). */
  marcarFalha(cupomId: string, motivo?: string): Promise<void>;
  /** Lista ids de cupons elegíveis a reprocessamento (C2.5). */
  listarParaReprocessar(filtro: FiltroReprocessamento): Promise<string[]>;
}
