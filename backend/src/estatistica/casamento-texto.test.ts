import { describe, expect, it } from 'vitest';

import {
  MatcherTexto,
  similaridade,
  sugerirCasamento,
  tokenizar,
  type CandidatoCanonico,
  type FonteCandidatosTexto,
} from './casamento-texto';

describe('similaridade de texto (C3.5)', () => {
  it('é 1 para descrições equivalentes (só variação de acento/caixa/espaço)', () => {
    expect(similaridade('Banana Prata', 'BANANA  PRATA')).toBeCloseTo(1, 6);
  });

  it('é alta para a mesma coisa com palavras a mais', () => {
    expect(similaridade('BANANA PRATA KG', 'BANANA PRATA')).toBeGreaterThan(0.5);
  });

  it('é baixa para produtos diferentes', () => {
    expect(similaridade('BANANA PRATA', 'DETERGENTE YPE')).toBeLessThan(0.2);
  });

  it('tolera abreviação/erro de digitação via trigramas', () => {
    expect(similaridade('REFRIGERANTE COCA COLA', 'REFRIG COCA COLA')).toBeGreaterThan(0.45);
  });
});

describe('tokenizar', () => {
  it('normaliza e descarta tokens de 1 caractere', () => {
    expect(tokenizar('Açúcar União 1kg a granel')).toEqual(['ACUCAR', 'UNIAO', '1KG', 'GRANEL']);
  });
});

describe('sugerirCasamento (C3.5)', () => {
  const candidatos: CandidatoCanonico[] = [
    { produtoCanonicoId: 'p-banana', descricaoNormalizada: 'BANANA PRATA' },
    { produtoCanonicoId: 'p-banana-nanica', descricaoNormalizada: 'BANANA NANICA' },
    { produtoCanonicoId: 'p-detergente', descricaoNormalizada: 'DETERGENTE YPE' },
  ];

  it('ranqueia por confiança e filtra abaixo do limiar', () => {
    const sug = sugerirCasamento('BANANA PRATA KG', candidatos);
    expect(sug[0]?.produtoCanonicoId).toBe('p-banana');
    expect(sug.every((s) => s.produtoCanonicoId !== 'p-detergente')).toBe(true);
  });

  it('lista vazia quando nada é plausível (produto novo)', () => {
    expect(sugerirCasamento('SABAO EM PO OMO', candidatos)).toEqual([]);
  });
});

describe('MatcherTexto (orquestra sobre a fonte de candidatos)', () => {
  it('sugere sobre os candidatos da mesma unidade-base', async () => {
    const fonte: FonteCandidatosTexto = {
      listarCandidatos: () =>
        Promise.resolve([{ produtoCanonicoId: 'p-banana', descricaoNormalizada: 'BANANA PRATA' }]),
      confirmarCasamento: () => Promise.resolve('alias-teste'),
    };
    const matcher = new MatcherTexto(fonte);
    const sug = await matcher.sugerir('Banana prata', 'kg');
    expect(sug[0]?.produtoCanonicoId).toBe('p-banana');
  });
});
