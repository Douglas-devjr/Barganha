import type { EstatisticaRegional } from '@barganha/shared';
import { describe, expect, it } from 'vitest';

import { type AlertaPrecoLinha, avaliarAlertasPreco, localDeEscopoGeo } from './alerta-preco';

const AGORA = new Date('2026-08-01T12:00:00.000Z');
const DIA_MS = 86_400_000;
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * DIA_MS).toISOString();

const alerta = (p: Partial<AlertaPrecoLinha> = {}): AlertaPrecoLinha => ({
  usuarioId: 'u1',
  produtoCanonicoId: 'arroz',
  nome: 'Arroz 5kg',
  precoAlvo: 20,
  escopoGeo: 'RJ',
  disparadoEm: null,
  ...p,
});

const est = (p: Partial<EstatisticaRegional> = {}): EstatisticaRegional => ({
  produtoCanonicoId: 'arroz',
  escopo: 'uf',
  escopoId: 'RJ',
  unidadeBase: 'kg',
  mediana: 18,
  p25: null,
  p75: null,
  minimo: null,
  maximo: null,
  menorPromocional: null,
  nObservacoes: 5,
  observadoEmMaisRecente: diasAtras(2),
  atualizadoEm: diasAtras(1),
  ...p,
});

describe('localDeEscopoGeo', () => {
  it('desmonta a chave de município (UF:MUNICIPIO)', () => {
    expect(localDeEscopoGeo('RJ:SAO GONCALO')).toEqual({ uf: 'RJ', municipio: 'SAO GONCALO' });
  });

  it('UF nua vira só { uf }', () => {
    expect(localDeEscopoGeo('RJ')).toEqual({ uf: 'RJ' });
  });
});

describe('avaliarAlertasPreco (C8.4)', () => {
  it('dispara quando a mediana bate o alvo e ainda não havia disparado', () => {
    const r = avaliarAlertasPreco(
      [alerta({ precoAlvo: 20 })],
      new Map([['arroz', [est({ mediana: 18 })]]]),
      AGORA,
    );
    expect(r.disparar).toHaveLength(1);
    expect(r.disparar[0]).toMatchObject({ usuarioId: 'u1', produtoCanonicoId: 'arroz' });
    expect(r.rearmar).toHaveLength(0);
  });

  it('NÃO dispara de novo — já disparado (dedupe)', () => {
    const r = avaliarAlertasPreco(
      [alerta({ precoAlvo: 20, disparadoEm: diasAtras(1) })],
      new Map([['arroz', [est({ mediana: 18 })]]]),
      AGORA,
    );
    expect(r.disparar).toHaveLength(0);
  });

  it('rearma quando já disparado e o preço voltou a subir acima de 5% do alvo', () => {
    const r = avaliarAlertasPreco(
      [alerta({ precoAlvo: 20, disparadoEm: diasAtras(5) })],
      new Map([['arroz', [est({ mediana: 22 })]]]), // 22 > 20 * 1.05 = 21
      AGORA,
    );
    expect(r.rearmar).toEqual([{ usuarioId: 'u1', produtoCanonicoId: 'arroz' }]);
    expect(r.disparar).toHaveLength(0);
  });

  it('NÃO rearma dentro da margem de histerese (<= alvo * 1.05)', () => {
    const r = avaliarAlertasPreco(
      [alerta({ precoAlvo: 20, disparadoEm: diasAtras(5) })],
      new Map([['arroz', [est({ mediana: 20.5 })]]]), // 20.5 <= 21
      AGORA,
    );
    expect(r.rearmar).toHaveLength(0);
  });

  it('cai para a UF quando o município do escopo_geo não tem estatística confiável', () => {
    const r = avaliarAlertasPreco(
      [alerta({ precoAlvo: 20, escopoGeo: 'RJ:SAO GONCALO' })],
      new Map([
        [
          'arroz',
          [
            est({ escopo: 'municipio', escopoId: 'RJ:SAO GONCALO', nObservacoes: 1, mediana: 5 }),
            est({ escopo: 'uf', escopoId: 'RJ', mediana: 18 }),
          ],
        ],
      ]),
      AGORA,
    );
    expect(r.disparar).toHaveLength(1);
    expect(r.disparar[0]?.disparo.mediana).toBe(18);
  });

  it('sem estatística para o produto: nem dispara nem rearma', () => {
    const r = avaliarAlertasPreco([alerta()], new Map(), AGORA);
    expect(r.disparar).toHaveLength(0);
    expect(r.rearmar).toHaveLength(0);
  });

  it('não dispara com preço velho (frescor herdado de avaliarAlerta)', () => {
    const r = avaliarAlertasPreco(
      [alerta({ precoAlvo: 20 })],
      new Map([['arroz', [est({ mediana: 18, observadoEmMaisRecente: diasAtras(90) })]]]),
      AGORA,
    );
    expect(r.disparar).toHaveLength(0);
  });

  it('processa múltiplos alertas independentemente', () => {
    const r = avaliarAlertasPreco(
      [
        alerta({ usuarioId: 'u1', produtoCanonicoId: 'arroz', precoAlvo: 20 }),
        alerta({ usuarioId: 'u2', produtoCanonicoId: 'feijao', precoAlvo: 8 }),
      ],
      new Map([
        ['arroz', [est({ produtoCanonicoId: 'arroz', mediana: 18 })]],
        ['feijao', [est({ produtoCanonicoId: 'feijao', mediana: 10 })]], // não bate
      ]),
      AGORA,
    );
    expect(r.disparar).toHaveLength(1);
    expect(r.disparar[0]?.produtoCanonicoId).toBe('arroz');
  });
});
