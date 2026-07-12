/** C8.4 — Regras puras do alerta: escolha do nível regional e disparo. */

import { describe, expect, it } from 'vitest';

import type { CacheEstatistica } from '../dados/tipos';
import { avaliarAlerta, escolherEstatisticaRegional } from './alertas-regras';

const est = (p: Partial<CacheEstatistica>): CacheEstatistica => ({
  produtoCanonicoId: 'arroz',
  escopo: 'uf',
  escopoId: 'RJ',
  unidadeBase: 'kg',
  mediana: 10,
  p25: null,
  p75: null,
  minimo: null,
  maximo: null,
  menorPromocional: null,
  nObservacoes: 5,
  atualizadoEm: '2026-07-10T00:00:00.000Z',
  ...p,
});

const ALERTA = { produtoCanonicoId: 'arroz', nome: 'Arroz 5kg', precoAlvo: 9 };

describe('escolherEstatisticaRegional (C8.4)', () => {
  it('município (chave normalizada) tem prioridade sobre UF; loja fica fora', () => {
    const escolhida = escolherEstatisticaRegional(
      [
        est({ escopo: 'loja', escopoId: '123', mediana: 1 }),
        est({ escopo: 'uf', escopoId: 'RJ', mediana: 12 }),
        est({ escopo: 'municipio', escopoId: 'RJ:SAO GONCALO', mediana: 9 }),
      ],
      { uf: 'RJ', municipio: 'São Gonçalo' },
    );
    expect(escolhida?.escopo).toBe('municipio');
  });

  it('descarta nível com poucas observações e cai para a UF', () => {
    const escolhida = escolherEstatisticaRegional(
      [
        est({ escopo: 'municipio', escopoId: 'RJ:NITEROI', nObservacoes: 1 }),
        est({ escopo: 'uf', escopoId: 'RJ', nObservacoes: 4 }),
      ],
      { uf: 'RJ', municipio: 'Niterói' },
    );
    expect(escolhida?.escopo).toBe('uf');
  });

  it('sem localização → null (não há região para alertar)', () => {
    expect(escolherEstatisticaRegional([est({})], null)).toBeNull();
  });
});

describe('avaliarAlerta (C8.4)', () => {
  it('dispara pelo típico quando a mediana chega ao alvo', () => {
    const r = avaliarAlerta(ALERTA, est({ mediana: 8.5 }));
    expect(r).toMatchObject({ motivo: 'tipico', mediana: 8.5 });
  });

  it('dispara pelo menor visto (mínimo/promoção) mesmo com típico acima', () => {
    const r = avaliarAlerta(ALERTA, est({ mediana: 11, minimo: 9.5, menorPromocional: 8.9 }));
    expect(r).toMatchObject({ motivo: 'menor_visto', menorVisto: 8.9 });
  });

  it('não dispara acima do alvo nem sem estatística', () => {
    expect(avaliarAlerta(ALERTA, est({ mediana: 10.5 }))).toBeNull();
    expect(avaliarAlerta(ALERTA, null)).toBeNull();
  });
});
