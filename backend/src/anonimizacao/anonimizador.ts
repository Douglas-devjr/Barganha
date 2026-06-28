/**
 * C2.4 — Camada de anonimização (lado backend).
 *
 * Recebe a `NotaEstruturada` (saída do parser) + o contexto PRIVADO do cupom e
 * produz DOIS mundos estritamente separados (docs/04):
 *   • itensPrivados → viram `item_cupom` (histórico do usuário; identificável).
 *   • observacoes   → `observacao_preco` SOLTAS e anônimas, geradas SEMPRE pelo
 *                     gate único de `@barganha/shared` (C1.4). CPF/chave/usuário
 *                     nunca cruzam: o gate copia só os campos permitidos.
 *
 * Só entra no pool o item que tem produto canônico (casado por EAN) E preço
 * normalizável — o resto fica apenas no histórico privado, aguardando C3.
 */

import {
  extrairObservacoesAnonimas,
  type ItemCupom,
  type ItemProcessado,
  type NotaEstruturada,
  type NotaProcessada,
  type ObservacaoAnonima,
} from '@barganha/shared';

import type { CatalogoProdutos } from './casamento';
import { normalizarDescricao, normalizarPreco } from './normalizacao';

/** Contexto identificável do cupom — entra aqui, NUNCA sai para o pool. */
export interface ContextoPrivado {
  usuarioId: string;
  cupomId: string;
  chaveAcesso?: string;
}

/** Item privado pronto para `item_cupom` (sem `id`/`cupomId`, postos na escrita). */
export type ItemCupomNovo = Omit<ItemCupom, 'id' | 'cupomId'>;

export interface ResultadoAnonimizacao {
  /** Dados da loja (para upsert em `loja`). */
  loja: NotaEstruturada['loja'];
  emitidoEm: string;
  /** Lado PRIVADO — vai para `item_cupom`. */
  itensPrivados: ItemCupomNovo[];
  /** Lado COMPARTILHADO — vai para `observacao_preco` (já passou pelo gate). */
  observacoes: ObservacaoAnonima[];
}

export class Anonimizador {
  constructor(private readonly catalogo: CatalogoProdutos) {}

  async anonimizar(
    nota: NotaEstruturada,
    contexto: ContextoPrivado,
  ): Promise<ResultadoAnonimizacao> {
    const itensPrivados: ItemCupomNovo[] = [];
    const itensPool: ItemProcessado[] = [];

    for (const item of nota.itens) {
      const norm = normalizarPreco(item);
      // Sinal de promoção da própria NFC-e (docs/06, camada 1).
      const emPromocao = item.desconto != null && item.desconto > 0;

      let produtoCanonicoId: string | undefined;
      if (item.ean && norm) {
        produtoCanonicoId = await this.catalogo.casarPorEan(item.ean, {
          descricaoNormalizada: normalizarDescricao(item.descricao),
          unidadeBase: norm.unidadeBase,
        });
      }

      itensPrivados.push({
        ...(produtoCanonicoId ? { produtoCanonicoId } : {}),
        descricaoOriginal: item.descricao,
        ...(item.ean ? { ean: item.ean } : {}),
        quantidade: item.quantidade,
        unidade: item.unidade,
        valorUnitario: item.valorUnitario,
        valorTotal: item.valorTotal,
        ...(item.desconto != null ? { desconto: item.desconto } : {}),
      });

      if (produtoCanonicoId && norm) {
        itensPool.push({
          produtoCanonicoId,
          precoNormalizado: norm.precoNormalizado,
          unidadeBase: norm.unidadeBase,
          emPromocao,
        });
      }
    }

    // ENTRADA do gate: carrega contexto privado de propósito — é onde ele é
    // descartado, não propagado. A saída é anônima por construção (C1.4).
    const notaProcessada: NotaProcessada = {
      loja: { cnpj: nota.loja.cnpj, municipio: nota.loja.municipio, uf: nota.loja.uf },
      observadoEm: nota.emitidoEm,
      itens: itensPool,
      usuarioId: contexto.usuarioId,
      cupomId: contexto.cupomId,
      ...(contexto.chaveAcesso ? { chaveAcesso: contexto.chaveAcesso } : {}),
    };

    return {
      loja: nota.loja,
      emitidoEm: nota.emitidoEm,
      itensPrivados,
      observacoes: extrairObservacoesAnonimas(notaProcessada),
    };
  }
}
