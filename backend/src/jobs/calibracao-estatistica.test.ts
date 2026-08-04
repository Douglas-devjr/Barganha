import { describe, expect, it } from 'vitest';

import type { ObservacaoParaAgregacao } from '../estatistica/tipos';
import { calibrar } from './calibracao-estatistica';

const REF = new Date('2026-08-01T00:00:00.000Z');
const DIA_MS = 86_400_000;

function obs(preco: number, diasAtras: number, emPromocao = false): ObservacaoParaAgregacao {
  return {
    produtoCanonicoId: 'p1',
    unidadeBase: 'kg',
    lojaCnpj: '11111111000191',
    municipio: 'SAO PAULO',
    uf: 'SP',
    precoNormalizado: preco,
    emPromocao,
    observadoEm: new Date(REF.getTime() - diasAtras * DIA_MS).toISOString(),
  };
}

describe('calibrar (núcleo do job de calibração)', () => {
  it('agrupa o pool solto e devolve as três medições, uma linha por nível no mínimo', () => {
    const observacoes = Array.from({ length: 5 }, (_, i) => obs(10 + i, i));
    const resumo = calibrar(observacoes, REF);

    expect(resumo.meiaVida.valorAtual).toBe(30);
    expect(resumo.fatorCerco.valorAtual).toBe(1.5);
    expect(resumo.minimoPorNivel).toHaveLength(4);
  });

  it('pool vazio não lança e reporta dados insuficientes nas três medições', () => {
    const resumo = calibrar([], REF);

    expect(resumo.meiaVida.valorRecomendado).toBeUndefined();
    expect(resumo.fatorCerco.valorRecomendado).toBeUndefined();
    for (const r of resumo.minimoPorNivel) expect(r.valorRecomendado).toBeUndefined();
  });
});
