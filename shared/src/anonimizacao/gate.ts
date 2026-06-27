/**
 * C1.4 — Fronteira de anonimização (gate ÚNICO de escrita no pool).
 *
 * Conceito de código que materializa a regra não-negociável (docs/04):
 *  • Toda `observacao_preco` que entra na base compartilhada PASSA por aqui.
 *  • CPF, `usuarioId`, `cupomId` e `chaveAcesso` são DESCARTADOS na fronteira.
 *  • Itens saem "soltos" (lista plana) — sem vínculo de cesta, quebrando a
 *    impressão digital que poderia re-identificar a pessoa.
 *
 * Duas garantias em tempo de COMPILAÇÃO:
 *  1. `SemDadoPessoal<…>` faz a saída colapsar para `never` se algum campo de
 *     dado pessoal for adicionado — quebrando o build de propósito.
 *  2. A marca `ObservacaoAnonima` só é produzível aqui; a persistência (C2.4)
 *     aceita exclusivamente este tipo, então não há outro caminho de escrita.
 */

import type { UnidadeBase } from '../core';
import type { ObservacaoPreco } from '../dominio/entidades';

/** Campos que NUNCA podem cruzar para o pool compartilhado. */
type ChavesProibidasNoPool = 'usuarioId' | 'cupomId' | 'chaveAcesso' | 'cpf' | 'nome';

/** Recusa, em tempo de compilação, qualquer tipo que contenha dado pessoal. */
export type SemDadoPessoal<T> = Extract<keyof T, ChavesProibidasNoPool> extends never ? T : never;

/** Nova observação anônima, pronta para inserir (`id` é gerado pelo banco). */
export type ObservacaoPrecoNova = Omit<ObservacaoPreco, 'id'>;

declare const MARCA_ANONIMA: unique symbol;
/**
 * Observação que comprovadamente passou pelo gate. Só `extrairObservacoesAnonimas`
 * produz este tipo — é o que a camada de persistência (C2.4) aceita escrever.
 */
export type ObservacaoAnonima = ObservacaoPrecoNova & { readonly [MARCA_ANONIMA]: true };

/** Item já parseado, normalizado e casado ao canônico (não-anônimo). */
export interface ItemProcessado {
  produtoCanonicoId: string;
  /** Preço já em R$/unidade_base (nunca valor cru). */
  precoNormalizado: number;
  unidadeBase: UnidadeBase;
  emPromocao: boolean;
}

/**
 * Nota privada já processada — ENTRADA do gate. Carrega contexto identificável
 * de propósito: este é o ponto onde ele é descartado, não propagado.
 */
export interface NotaProcessada {
  loja: { cnpj: string; municipio?: string; uf?: string };
  /** Data de emissão da nota (ISO 8601) — vira `observadoEm`. */
  observadoEm: string;
  itens: ItemProcessado[];

  // Contexto PRIVADO — presente aqui, NUNCA na saída.
  usuarioId: string;
  cupomId: string;
  chaveAcesso?: string;
}

/**
 * O GATE. Converte uma nota processada em observações anônimas soltas,
 * copiando apenas os campos permitidos — qualquer PII na entrada é ignorada
 * por construção (nunca é lida).
 */
export function extrairObservacoesAnonimas(nota: NotaProcessada): ObservacaoAnonima[] {
  return nota.itens.map((item): SemDadoPessoal<ObservacaoPrecoNova> => ({
    produtoCanonicoId: item.produtoCanonicoId,
    lojaCnpj: nota.loja.cnpj,
    municipio: nota.loja.municipio,
    uf: nota.loja.uf,
    precoNormalizado: item.precoNormalizado,
    unidadeBase: item.unidadeBase,
    emPromocao: item.emPromocao,
    observadoEm: nota.observadoEm,
  })) as ObservacaoAnonima[];
}

/**
 * Contrato da camada de persistência do pool (implementada em C2.4):
 * só aceita `ObservacaoAnonima`, garantindo que toda escrita veio do gate.
 */
export interface EscritorPoolCompartilhado {
  inserirObservacoes(observacoes: ObservacaoAnonima[]): Promise<void>;
}
