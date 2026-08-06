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
 * Só entra no pool o item que tem produto canônico E preço normalizável. A
 * ORDEM do casamento (EAN → loja+código interno → alias confirmado → descrição
 * exata) não mora aqui: mora no `ResolvedorProduto`, fonte única compartilhada
 * com o backfill (`job:republicar`). O resto fica apenas no histórico privado.
 */

import {
  extrairObservacoesAnonimas,
  type ItemCupom,
  type ItemProcessado,
  type NotaEstruturada,
  type NotaProcessada,
  type ObservacaoAnonima,
  precoUnitarioEfetivo,
} from '@barganha/shared';

import { telemetriaNula, type Telemetria } from '../observabilidade/telemetria';
import type { CatalogoProdutos, FonteAliasTexto, MapaCodigoLoja } from './casamento';
import {
  chaveUnidade,
  normalizarDescricao,
  normalizarPreco,
  unidadeConhecida,
} from './normalizacao';
import { type OpcoesResolvedor, ResolvedorProduto } from './resolvedor-produto';

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

/** Fontes opcionais do casamento. Ausentes = comportamento anterior à C3.6.1. */
export interface FontesCasamento extends OpcoesResolvedor {
  mapaCodigoLoja?: MapaCodigoLoja;
  aliasTexto?: FonteAliasTexto;
}

export class Anonimizador {
  private readonly resolvedor: ResolvedorProduto;

  constructor(
    catalogo: CatalogoProdutos,
    private readonly telemetria: Telemetria = telemetriaNula,
    fontes: FontesCasamento = {},
  ) {
    const { mapaCodigoLoja, aliasTexto, ...opcoes } = fontes;
    this.resolvedor = new ResolvedorProduto(
      catalogo,
      {
        ...(mapaCodigoLoja ? { mapaCodigoLoja } : {}),
        ...(aliasTexto ? { aliasTexto } : {}),
      },
      opcoes,
    );
  }

  /**
   * @param ufCanonica UF derivada da CHAVE de acesso (cUF) — fonte mais
   *   confiável que o endereço parseado; sobrepõe a UF da loja para a `loja` e
   *   o pool. Ausente → cai para a UF do endereço.
   */
  async anonimizar(
    nota: NotaEstruturada,
    contexto: ContextoPrivado,
    ufCanonica?: string,
  ): Promise<ResultadoAnonimizacao> {
    const uf = ufCanonica ?? nota.loja.uf;
    const loja = { ...nota.loja, uf };
    const itensPrivados: ItemCupomNovo[] = [];
    const itensPool: ItemProcessado[] = [];

    for (const item of nota.itens) {
      // O pool recebe o preço que o consumidor PAGOU: com desconto no item, o
      // unitário efetivo (líquido) — senão o "menor promocional" (docs/06)
      // reportaria o preço cheio de um item que estava em promoção.
      // A descrição entra só para destravar multipack (CX/FD com a contagem
      // declarada, C3.4) — nunca altera o fator de uma unidade já conhecida.
      const norm = normalizarPreco({
        unidade: item.unidade,
        valorUnitario: precoUnitarioEfetivo(item),
        descricao: item.descricao,
      });
      // C3.4 — a unidade caiu fora do pool porque o mapa nunca a viu (não por
      // faltar contagem de multipack, já esperado): conta por UF para a
      // abreviação aparecer no /metricas em vez de sumir em silêncio.
      if (!norm && !unidadeConhecida(item.unidade)) {
        this.telemetria.registrarUnidadeRecusada(uf, chaveUnidade(item.unidade));
      }
      // Sinal de promoção da própria NFC-e (docs/06, camada 1).
      const emPromocao = item.desconto != null && item.desconto > 0;

      let produtoCanonicoId: string | undefined;
      if (norm) {
        // Ordem única em `ResolvedorProduto`: EAN → (loja, código interno) →
        // alias confirmado → descrição exata. O preço normalizado entra só
        // para alimentar o SINAL de salto de preço da guarda do código; ele
        // nunca decide casamento sozinho.
        const resolucao = await this.resolvedor.resolver({
          descricaoNormalizada: normalizarDescricao(item.descricao),
          unidadeBase: norm.unidadeBase,
          lojaCnpj: loja.cnpj,
          ...(item.ean ? { ean: item.ean } : {}),
          ...(item.codigoLoja ? { codigoLoja: item.codigoLoja } : {}),
          precoNormalizado: norm.precoNormalizado,
        });
        produtoCanonicoId = resolucao.produtoCanonicoId;
      }

      itensPrivados.push({
        ...(produtoCanonicoId ? { produtoCanonicoId } : {}),
        descricaoOriginal: item.descricao,
        ...(item.ean ? { ean: item.ean } : {}),
        // PRIVADO só (item_cupom) — nunca entra em itensPool/observações: o
        // gate (shared/anonimizacao/gate.ts) não tem slot para ele. O código
        // já foi USADO no casamento acima; o que vive no lado compartilhado é
        // o mapeamento em `produto_codigo_loja`, não a linha do cupom.
        ...(item.codigoLoja ? { codigoLoja: item.codigoLoja } : {}),
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
      loja: { cnpj: loja.cnpj, municipio: loja.municipio, uf },
      observadoEm: nota.emitidoEm,
      itens: itensPool,
      usuarioId: contexto.usuarioId,
      cupomId: contexto.cupomId,
      ...(contexto.chaveAcesso ? { chaveAcesso: contexto.chaveAcesso } : {}),
    };

    return {
      loja,
      emitidoEm: nota.emitidoEm,
      itensPrivados,
      observacoes: extrairObservacoesAnonimas(notaProcessada),
    };
  }
}
