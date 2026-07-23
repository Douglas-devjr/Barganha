/**
 * C3.1 — Pipeline de agregação `preco_estatistica`.
 *
 * Liga o pool anônimo (`observacao_preco`) ao núcleo puro de agregação e grava
 * o cache `preco_estatistica` — uma linha por (produto × unidade-base × escopo).
 * A MESMA observação alimenta loja, município, região e UF (agregação aninhada
 * via `derivarEscopos`, C3.3).
 *
 * É a peça "job": roda sob demanda (recalcular um produto) ou em lote (todos os
 * produtos com observação nova). Quem dispara — após ingestão (C2) ou num cron
 * (C10) — é decidido fora daqui; o pipeline só recalcula e persiste.
 */

import { agregar, DECAIMENTO, type OpcoesAgregacao } from './agregacao';
import { derivarEscopos, type ResolvedorRegiao } from './escopos';
import type {
  FonteObservacoes,
  LinhaEstatistica,
  ObservacaoParaAgregacao,
  RepositorioEstatistica,
} from './tipos';

export interface OpcoesPipeline {
  /** "Agora" do decaimento temporal (injetável p/ testes determinísticos). */
  referencia?: Date;
  /** Resolve a chave de região; por padrão pula o nível (sem dado na v1). */
  resolverRegiao?: ResolvedorRegiao;
  /** Overrides de calibração da agregação (meia-vida, janela, cerco de promo). */
  agregacao?: Omit<OpcoesAgregacao, 'referencia'>;
}

const DIA_MS = 86_400_000;

interface Balde {
  escopo: LinhaEstatistica['escopo'];
  escopoId: string;
  unidadeBase: LinhaEstatistica['unidadeBase'];
  observacoes: ObservacaoParaAgregacao[];
}

export class PipelineEstatistica {
  constructor(
    private readonly fonte: FonteObservacoes,
    private readonly repo: RepositorioEstatistica,
    private readonly opcoes: OpcoesPipeline = {},
  ) {}

  /** Recalcula e grava todos os escopos de um produto. Retorna nº de linhas. */
  async recalcularProduto(produtoCanonicoId: string): Promise<number> {
    const observacoes = await this.fonte.observacoesDoProduto(
      produtoCanonicoId,
      this.inicioDaJanela(),
    );
    const linhas = this.calcularLinhas(produtoCanonicoId, observacoes);
    if (linhas.length > 0) await this.repo.upsertEstatisticas(linhas);
    return linhas.length;
  }

  /** Recalcula todos os produtos com observação (opcionalmente só os recentes). */
  async recalcularTodos(desde?: string): Promise<number> {
    const ids = await this.fonte.listarProdutosComObservacoes(desde);
    let total = 0;
    const feitos: string[] = [];
    for (const id of ids) {
      total += await this.recalcularProduto(id);
      feitos.push(id);
    }
    // Só desmarca o que de fato recalculou: se o laço morrer no meio, o que
    // sobrou continua pendente e a próxima rodada pega.
    await this.fonte.limparPendenciaRecalculo?.(feitos);
    return total;
  }

  /**
   * Início da janela do decaimento (ISO) — o mesmo `maxIdadeDias` que `agregar()`
   * usa para descartar observação velha, só que aplicado JÁ na consulta. Sem
   * isto, um produto popular traz o histórico inteiro do banco para a memória e
   * esbarra no teto de linhas do PostgREST antes de chegar aqui.
   */
  private inicioDaJanela(): string {
    const maxIdadeDias = this.opcoes.agregacao?.maxIdadeDias ?? DECAIMENTO.maxIdadeDias;
    const referencia = this.opcoes.referencia ?? new Date();
    return new Date(referencia.getTime() - maxIdadeDias * DIA_MS).toISOString();
  }

  /** Agrupa as observações por (unidade-base × escopo) e agrega cada balde. */
  private calcularLinhas(
    produtoCanonicoId: string,
    observacoes: readonly ObservacaoParaAgregacao[],
  ): LinhaEstatistica[] {
    const referencia = this.opcoes.referencia ?? new Date();
    const baldes = new Map<string, Balde>();

    for (const o of observacoes) {
      const escopos = derivarEscopos(
        { lojaCnpj: o.lojaCnpj, municipio: o.municipio, uf: o.uf },
        this.opcoes.resolverRegiao,
      );
      for (const { escopo, escopoId } of escopos) {
        const chave = `${o.unidadeBase}|${escopo}|${escopoId}`;
        let balde = baldes.get(chave);
        if (!balde) {
          balde = { escopo, escopoId, unidadeBase: o.unidadeBase, observacoes: [] };
          baldes.set(chave, balde);
        }
        balde.observacoes.push(o);
      }
    }

    const linhas: LinhaEstatistica[] = [];
    for (const balde of baldes.values()) {
      const estat = agregar(balde.observacoes, { referencia, ...this.opcoes.agregacao });
      if (!estat) continue;
      linhas.push({
        produtoCanonicoId,
        escopo: balde.escopo,
        escopoId: balde.escopoId,
        unidadeBase: balde.unidadeBase,
        mediana: estat.mediana,
        p25: estat.p25,
        p75: estat.p75,
        minimo: estat.minimo,
        maximo: estat.maximo,
        ...(estat.menorPromocional != null ? { menorPromocional: estat.menorPromocional } : {}),
        nObservacoes: estat.nObservacoes,
      });
    }
    return linhas;
  }
}
