import { describe, expect, it, vi } from 'vitest';

import { executarRecalculoEmLote, type PipelineRecalculavel } from './recalculo-estatistica';

const REF = new Date('2026-07-01T12:00:00.000Z');

/** Pipeline falso que registra o `desde` recebido e devolve um nº fixo de linhas. */
function pipelineFake(linhas = 7): {
  pipeline: PipelineRecalculavel;
  recalcularTodos: ReturnType<typeof vi.fn>;
} {
  // Sem parâmetro declarado: o vi.fn ainda registra os argumentos recebidos
  // (checados via toHaveBeenCalledWith) e é atribuível à porta com `desde?`.
  const recalcularTodos = vi.fn(() => Promise.resolve(linhas));
  return { pipeline: { recalcularTodos }, recalcularTodos };
}

describe('executarRecalculoEmLote (C3.1/C10)', () => {
  it('deriva `desde` da janela de retrovisão e repassa ao pipeline', async () => {
    const { pipeline, recalcularTodos } = pipelineFake();

    const resumo = await executarRecalculoEmLote(pipeline, { lookbackMinutos: 180, agora: REF });

    // 180 min antes de 12:00 → 09:00.
    expect(recalcularTodos).toHaveBeenCalledWith('2026-07-01T09:00:00.000Z');
    expect(resumo.desde).toBe('2026-07-01T09:00:00.000Z');
    expect(resumo.linhasRecalculadas).toBe(7);
  });

  it('lookback 0 → recálculo COMPLETO (sem `desde`)', async () => {
    const { pipeline, recalcularTodos } = pipelineFake(42);

    const resumo = await executarRecalculoEmLote(pipeline, { lookbackMinutos: 0, agora: REF });

    expect(recalcularTodos).toHaveBeenCalledWith(undefined);
    expect(resumo.desde).toBeUndefined();
    expect(resumo.linhasRecalculadas).toBe(42);
  });

  it('lookback negativo também é tratado como completo', async () => {
    const { pipeline, recalcularTodos } = pipelineFake();

    const resumo = await executarRecalculoEmLote(pipeline, { lookbackMinutos: -5, agora: REF });

    expect(recalcularTodos).toHaveBeenCalledWith(undefined);
    expect(resumo.desde).toBeUndefined();
  });
});
