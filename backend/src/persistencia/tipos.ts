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

import { createHash } from 'node:crypto';

import type { NotaEstruturada, ObservacaoAnonima, StatusCupom, TotaisNota } from '@barganha/shared';

import type { ItemCupomNovo } from '../anonimizacao/anonimizador';

/**
 * C9.2.1 — Hash da chave de acesso para o dedup GLOBAL do pool. A chave crua
 * nunca sai do lado privado; `chave_publicada` só conhece este SHA-256.
 */
export function hashChavePool(chaveAcesso: string): string {
  return createHash('sha256').update(chaveAcesso).digest('hex');
}

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
  /**
   * C9.2.1 — Hash (`hashChavePool`) da chave de acesso: dedup global do pool.
   * Com ele presente e havendo observações, a chave só publica UMA vez —
   * qualquer conta que reprocessar o mesmo cupom mantém o histórico privado,
   * mas o pool não recebe de novo.
   */
  chaveHash?: string;
}

/** Desfecho do `marcarProcessado` do ponto de vista do POOL. */
export interface ResultadoMarcarProcessado {
  /**
   * `false` = havia observações mas a chave JÁ tinha publicado (dedup C9.2.1):
   * o chamador não deve disparar recálculo nem contar publicação.
   */
  poolPublicado: boolean;
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

/**
 * Uma linha do histórico do usuário para a rehidratação no login (restore,
 * docs/04). É o `CupomComItens` (cabeçalho + itens) mais o que o espelho LOCAL
 * precisa para ser fiel: o QR cru (invariante NOT NULL local + reprocessamento
 * retroativo), a chave de acesso (idempotência local) e o instante de captura
 * (base da sequência/selos). É lado privado de ponta a ponta — nunca cruza o pool.
 */
export interface CupomHistorico extends CupomComItens {
  qrPayload: string;
  chaveAcesso?: string;
  capturadoEm: string;
}

/**
 * Posição keyset da paginação do histórico: a captura, desempatada pelo id do
 * cupom (dois cupons podem ter o mesmo `capturado_em` ao milissegundo).
 */
export interface CursorHistorico {
  capturadoEm: string;
  cupomId: string;
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
   * Página do histórico privado do PRÓPRIO usuário para a rehidratação no login
   * (restore, docs/04). Escopo do dono na própria consulta (`usuario_id`): nunca
   * vaza cupom de terceiro. Ordena por captura (mais antigo → novo), desempatada
   * por id; `apos` é a keyset da última linha da página anterior (ausente = 1ª
   * página). Traz o cupom COMPLETO (cabeçalho + itens + QR) para o app
   * reconstruir o espelho local. Devolve no máximo `limite` linhas.
   */
  listarHistoricoDoUsuario(
    usuarioId: string,
    opcoes: { limite: number; apos?: CursorHistorico },
  ): Promise<CupomHistorico[]>;
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
  ): Promise<ResultadoMarcarProcessado>;
  /**
   * C2.6 — BACKFILL dos totais de um cupom JÁ `processado` que ainda não os tem
   * (processado antes do recurso de totais existir; o retro C2.5 não o alcança).
   * Só escreve quando `valor_pago` ainda é nulo — nunca sobrescreve, nunca toca
   * itens/pool (zero risco de duplicação).
   */
  atualizarTotais(cupomId: string, total: TotaisNota): Promise<void>;
  /**
   * Apaga um cupom do PRÓPRIO usuário e, em cascata, seus itens (direito ao
   * apagamento, docs/04). Devolve `false` quando o cupom não existe ou é de
   * outro dono — a camada HTTP traduz para 404, sem vazar existência.
   *
   * NÃO toca o pool: as `observacao_preco` geradas por este cupom são anônimas e
   * SOLTAS — não existe coluna que as religue ao cupom (decisão travada nº3), e
   * por isso não há o que apagar lá. Também não limpa `chave_publicada`: o hash
   * da chave permanece para o dedup global continuar valendo se o mesmo cupom for
   * reescaneado por qualquer conta (C9.2.1).
   */
  apagarDoUsuario(cupomId: string, usuarioId: string): Promise<boolean>;
  /** Marca o cupom como `falha` (erro permanente de parsing). */
  marcarFalha(cupomId: string, motivo?: string): Promise<void>;
  /** Lista ids de cupons elegíveis a reprocessamento (C2.5). */
  listarParaReprocessar(filtro: FiltroReprocessamento): Promise<string[]>;
}
