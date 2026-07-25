import type { EscopoGeo, PrecoEstatistica } from '@barganha/shared';
import { describe, expect, it } from 'vitest';

import { chaveEscopo, derivarEscopos, resolverFallback, type LocalGeo } from './escopos';

const LOCAL: LocalGeo = { lojaCnpj: '12345678000199', municipio: 'Rio de Janeiro', uf: 'RJ' };

function estat(escopo: EscopoGeo, escopoId: string, n: number): PrecoEstatistica {
  return {
    produtoCanonicoId: 'p-1',
    escopo,
    escopoId,
    unidadeBase: 'L',
    mediana: 6.5,
    p25: 6.0,
    p75: 7.0,
    nObservacoes: n,
    atualizadoEm: '2026-06-20T00:00:00.000Z',
  };
}

describe('chaveEscopo / derivarEscopos (C3.3)', () => {
  it('deriva loja, município (UF:Município) e UF; pula região na v1', () => {
    expect(chaveEscopo('loja', LOCAL)).toBe('12345678000199');
    expect(chaveEscopo('municipio', LOCAL)).toBe('RJ:RIO DE JANEIRO');
    expect(chaveEscopo('uf', LOCAL)).toBe('RJ');
    expect(chaveEscopo('regiao', LOCAL)).toBeUndefined();

    expect(derivarEscopos(LOCAL)).toEqual([
      { escopo: 'loja', escopoId: '12345678000199' },
      { escopo: 'municipio', escopoId: 'RJ:RIO DE JANEIRO' },
      { escopo: 'uf', escopoId: 'RJ' },
    ]);
  });

  it('usa o ResolvedorRegiao quando há dado de metrorregião', () => {
    const resolver = () => 'RJ-metro';
    expect(chaveEscopo('regiao', LOCAL, resolver)).toBe('RJ-metro');
    expect(derivarEscopos(LOCAL, resolver).map((e) => e.escopo)).toEqual([
      'loja',
      'municipio',
      'regiao',
      'uf',
    ]);
  });

  it('não deriva município sem UF (chave ambígua)', () => {
    expect(chaveEscopo('municipio', { lojaCnpj: 'x', municipio: 'Niterói' })).toBeUndefined();
  });
});

describe('resolverFallback (C3.3)', () => {
  it('escolhe o nível mais específico com base suficiente', () => {
    const candidatos = [
      estat('loja', '12345678000199', 5),
      estat('municipio', 'RJ:RIO DE JANEIRO', 50),
      estat('uf', 'RJ', 500),
    ];
    const r = resolverFallback(candidatos, LOCAL);
    expect(r?.escopoResolvido).toBe('loja');
    expect(r?.baixaConfianca).toBe(false);
  });

  it('sobe de nível quando o mais específico não atinge o mínimo', () => {
    const candidatos = [
      estat('loja', '12345678000199', 1), // < mínimo
      estat('municipio', 'RJ:RIO DE JANEIRO', 50),
      estat('uf', 'RJ', 500),
    ];
    expect(resolverFallback(candidatos, LOCAL)?.escopoResolvido).toBe('municipio');
  });

  it('ignora candidatos de outro local (loja/município diferentes)', () => {
    const candidatos = [
      estat('loja', '99999999000100', 100), // outra loja
      estat('uf', 'RJ', 4),
    ];
    const r = resolverFallback(candidatos, LOCAL);
    expect(r?.escopoResolvido).toBe('uf');
  });

  it('quando ninguém atinge o mínimo, devolve o de maior base com ressalva', () => {
    const candidatos = [estat('loja', '12345678000199', 1), estat('uf', 'RJ', 2)];
    const r = resolverFallback(candidatos, LOCAL);
    expect(r?.escopoResolvido).toBe('uf');
    expect(r?.baixaConfianca).toBe(true);
  });

  it('sem candidatos → undefined', () => {
    expect(resolverFallback([], LOCAL)).toBeUndefined();
  });

  it('não serve LOJA abaixo do piso nem como "maior base" (docs/04)', () => {
    // Sem a supressão, a loja com n=2 venceria o município com n=1 no passo 2 e
    // o app exibiria uma mediana que é, na prática, a compra de uma pessoa.
    const candidatos = [
      estat('loja', '12345678000199', 2),
      estat('municipio', 'RJ:RIO DE JANEIRO', 1),
    ];
    const r = resolverFallback(candidatos, LOCAL);
    expect(r?.escopoResolvido).toBe('municipio');
    expect(r?.baixaConfianca).toBe(true);
  });

  it('só há LOJA rasa → nada é servido (404), em vez de vazar a célula', () => {
    expect(resolverFallback([estat('loja', '12345678000199', 2)], LOCAL)).toBeUndefined();
  });

  it('com duas unidades-base no mesmo nível, escolhe a de maior base (n)', () => {
    const candidatos = [
      { ...estat('municipio', 'RJ:RIO DE JANEIRO', 3), unidadeBase: 'un' as const },
      { ...estat('municipio', 'RJ:RIO DE JANEIRO', 40), unidadeBase: 'kg' as const },
    ];
    const r = resolverFallback(candidatos, LOCAL);
    expect(r?.estatistica.unidadeBase).toBe('kg');
    expect(r?.estatistica.nObservacoes).toBe(40);
  });
});
