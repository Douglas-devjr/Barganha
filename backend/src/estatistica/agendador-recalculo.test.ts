import { describe, expect, it } from 'vitest';

import { AgendadorRecalculo, type RecalculadorProduto } from './agendador-recalculo';

/** Pipeline de mentira que registra a ordem dos recálculos. */
class PipelineEspiao implements RecalculadorProduto {
  readonly recalculados: string[] = [];
  constructor(private readonly falharEm: ReadonlySet<string> = new Set()) {}
  recalcularProduto(produtoCanonicoId: string): Promise<number> {
    this.recalculados.push(produtoCanonicoId);
    if (this.falharEm.has(produtoCanonicoId)) {
      return Promise.reject(new Error(`falha proposital em ${produtoCanonicoId}`));
    }
    return Promise.resolve(1);
  }
}

describe('AgendadorRecalculo', () => {
  it('recalcula cada produto marcado', async () => {
    const pipeline = new PipelineEspiao();
    const agendador = new AgendadorRecalculo(pipeline);

    agendador.marcar(['p-1', 'p-2', 'p-3']);
    await agendador.ociosa();

    expect(pipeline.recalculados.sort()).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('marcar RETORNA antes de o lote terminar (não segura o worker da fila)', async () => {
    // O ponto da mudança: o processador do cupom devolve a resposta sem esperar
    // as dezenas de agregações dos itens. Aqui o pipeline fica preso num
    // portão; quem chamou `marcar` já seguiu em frente, e só o primeiro produto
    // chegou a começar.
    const recalculados: string[] = [];
    let abrirPortao!: () => void;
    const portao = new Promise<void>((r) => {
      abrirPortao = r;
    });
    const agendador = new AgendadorRecalculo({
      async recalcularProduto(id) {
        recalculados.push(id);
        await portao;
        return 1;
      },
    });

    agendador.marcar(['p-1', 'p-2', 'p-3']);
    expect(recalculados).toHaveLength(1); // o laço parou no primeiro await

    abrirPortao();
    await agendador.ociosa();
    expect(recalculados.sort()).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('COALESCE: o mesmo produto em vários cupons vira um recálculo só', async () => {
    // O caso real: uma leva de cupons do mesmo mercado repete os mesmos
    // produtos. Antes, cada cupom disparava a agregação completa de cada item,
    // jogando fora o trabalho do anterior.
    const pipeline = new PipelineEspiao();
    const agendador = new AgendadorRecalculo(pipeline);

    agendador.marcar(['arroz', 'feijao']);
    agendador.marcar(['arroz', 'feijao']);
    agendador.marcar(['arroz']);
    await agendador.ociosa();

    expect(pipeline.recalculados.filter((p) => p === 'arroz').length).toBeLessThanOrEqual(2);
    expect(new Set(pipeline.recalculados)).toEqual(new Set(['arroz', 'feijao']));
  });

  it('uma falha não derruba o laço nem os outros produtos', async () => {
    const falhas: string[] = [];
    const pipeline = new PipelineEspiao(new Set(['p-2']));
    const agendador = new AgendadorRecalculo(pipeline, {
      aoFalhar: (id) => falhas.push(id),
    });

    agendador.marcar(['p-1', 'p-2', 'p-3']);
    await agendador.ociosa();

    expect(falhas).toEqual(['p-2']);
    expect(pipeline.recalculados.sort()).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('produto marcado DURANTE o próprio recálculo é reagendado', async () => {
    // Chega observação nova enquanto a agregação roda: o resultado gravado é
    // anterior a ela, então o produto precisa voltar para a fila.
    const recalculados: string[] = [];
    let remarcou = false;
    const agendador: AgendadorRecalculo = new AgendadorRecalculo({
      recalcularProduto(id) {
        recalculados.push(id);
        if (!remarcou) {
          remarcou = true;
          agendador.marcar([id]);
        }
        return Promise.resolve(1);
      },
    });

    agendador.marcar(['p-1']);
    await agendador.ociosa();

    expect(recalculados).toEqual(['p-1', 'p-1']);
  });
});
