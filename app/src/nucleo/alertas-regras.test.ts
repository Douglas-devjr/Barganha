/**
 * C8.4 — A regra em si (escolha de escopo + disparo, com toda a casuística de
 * frescor/histerese) foi movida para `@barganha/shared/dominio/alertas-regras`
 * e é testada lá (`shared/src/dominio/alertas-regras.test.ts`), contra o mesmo
 * tipo `EstatisticaRegional` que o job do backend usa — duplicar os casos aqui
 * testaria a mesma lógica duas vezes sem ganho.
 *
 * Este teste fica só para travar o RE-EXPORT: se `./alertas-regras` parar de
 * expor `avaliarAlerta`/`escolherEstatisticaRegional` (ou o app trocar de
 * versão do shared sem essas funções), os consumidores locais (`alertas.ts`,
 * `tipico-regional.ts`, `notificacoes-regras.ts`) quebram em silêncio até
 * alguém tropeçar em runtime — este teste falha primeiro, no CI.
 */

import { describe, expect, it } from 'vitest';

import type { CacheEstatistica } from '../dados/tipos';
import { avaliarAlerta, escolherEstatisticaRegional } from './alertas-regras';

const AGORA = new Date('2026-07-29T12:00:00.000Z');

const ESTATISTICA: CacheEstatistica = {
  produtoCanonicoId: 'arroz',
  escopo: 'uf',
  escopoId: 'RJ',
  unidadeBase: 'kg',
  mediana: 8.5,
  p25: null,
  p75: null,
  minimo: null,
  maximo: null,
  menorPromocional: null,
  nObservacoes: 5,
  observadoEmMaisRecente: new Date(AGORA.getTime() - 3 * 86_400_000).toISOString(),
  atualizadoEm: AGORA.toISOString(),
};

describe('alertas-regras (re-export de @barganha/shared)', () => {
  it('escolhe a estatística regional e dispara o alerta — CacheEstatistica é compatível', () => {
    const regional = escolherEstatisticaRegional([ESTATISTICA], { uf: 'RJ' });
    expect(regional).not.toBeNull();

    const disparo = avaliarAlerta(
      { produtoCanonicoId: 'arroz', nome: 'Arroz 5kg', precoAlvo: 9 },
      regional,
      AGORA,
    );
    expect(disparo).toMatchObject({ motivo: 'tipico', mediana: 8.5 });
  });
});
