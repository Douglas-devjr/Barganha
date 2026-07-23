/**
 * Agendador de recálculo de `preco_estatistica` — desacopla o recálculo do
 * ciclo de processamento do cupom.
 *
 * O PROBLEMA. O recálculo pós-ingestão era feito em linha, dentro do worker da
 * fila: `for (const id of ids) await pipeline.recalcularProduto(id)`. Um cupom
 * de mercado tem dezenas de itens, então UM cupom disparava dezenas de
 * agregações completas — sequenciais, e segurando o worker o tempo todo. Com
 * vários cupons do mesmo mercado na fila (o caso comum: mesma rede, mesmos
 * produtos), o mesmo produto era reagregado uma vez por cupom, jogando fora o
 * trabalho anterior.
 *
 * A CORREÇÃO. `marcar()` só anota os produtos e volta na hora; um laço próprio
 * drena o conjunto em segundo plano. Como o pendente é um `Set`, marcar o mesmo
 * produto dez vezes enquanto ele espera custa UM recálculo — é a coalescência
 * que faz a diferença num lote de cupons parecidos.
 *
 * REDE DE SEGURANÇA. Isto é best-effort de propósito: se o processo cair com
 * pendências, elas se perdem AQUI, mas não no sistema — toda inserção no pool
 * também enfileira o produto em `produto_recalculo_pendente` (trigger no
 * banco), e o job em lote (C3.1/C10) recalcula o que ficou para trás.
 */

/** Porta mínima do pipeline: recalcular UM produto. */
export interface RecalculadorProduto {
  recalcularProduto(produtoCanonicoId: string): Promise<number>;
}

export interface OpcoesAgendador {
  /** Chamado quando o recálculo de um produto falha (telemetria/log). */
  aoFalhar?: (produtoCanonicoId: string, erro: unknown) => void;
}

export class AgendadorRecalculo {
  private readonly pendentes = new Set<string>();
  private drenando = false;
  private cicloAtual: Promise<void> = Promise.resolve();

  constructor(
    private readonly pipeline: RecalculadorProduto,
    private readonly opcoes: OpcoesAgendador = {},
  ) {}

  /** Anota os produtos e retorna IMEDIATAMENTE — não espera o recálculo. */
  marcar(produtoCanonicoIds: readonly string[]): void {
    for (const id of produtoCanonicoIds) this.pendentes.add(id);
    this.bombear();
  }

  /** Resolve quando não há mais nada pendente nem em curso (testes/shutdown). */
  async ociosa(): Promise<void> {
    while (this.drenando || this.pendentes.size > 0) {
      await this.cicloAtual;
    }
  }

  private bombear(): void {
    if (this.drenando || this.pendentes.size === 0) return;
    this.drenando = true;
    this.cicloAtual = this.drenar().finally(() => {
      this.drenando = false;
      // Algo marcado enquanto o ciclo terminava: reativa.
      if (this.pendentes.size > 0) this.bombear();
    });
  }

  private async drenar(): Promise<void> {
    while (this.pendentes.size > 0) {
      // Retira ANTES de recalcular: se o produto for marcado de novo durante a
      // agregação, ele volta para a fila e é reagregado com o dado novo.
      const [id] = this.pendentes;
      if (id === undefined) return;
      this.pendentes.delete(id);
      try {
        await this.pipeline.recalcularProduto(id);
      } catch (erro) {
        // Não derruba o laço: o job em lote refaz o que falhar aqui.
        this.opcoes.aoFalhar?.(id, erro);
      }
    }
  }
}
