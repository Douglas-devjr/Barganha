import { describe, expect, it } from 'vitest';

import type { ObservacaoParaAgregacao } from '../estatistica/tipos';
import {
  calibrar,
  divergenciasDeCalibracao,
  formatarAvisoCalibracao,
  type ResumoCalibracao,
} from './calibracao-estatistica';

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
  it('agrupa o pool solto e devolve as quatro medições, uma linha por nível/família', () => {
    const observacoes = Array.from({ length: 5 }, (_, i) => obs(10 + i, i));
    const resumo = calibrar(observacoes, REF, new Map([['p1', 'Hortifruti']]));

    expect(resumo.meiaVida.valorAtual).toBe(30);
    expect(resumo.fatorCerco.valorAtual).toBe(1.5);
    expect(resumo.minimoPorNivel).toHaveLength(4);
    expect(resumo.zonaMorta.map((r) => r.familia)).toEqual(['fresco', 'industrializado', 'outros']);
  });

  it('sem mapa de categorias a zona morta ainda é medida, toda em `outros`', () => {
    // Catálogo sem enriquecimento é o estado real hoje — não é base faltando.
    const observacoes = Array.from({ length: 5 }, (_, i) => obs(10 + i, i));
    const resumo = calibrar(observacoes, REF);
    expect(resumo.zonaMorta).toHaveLength(3);
  });

  it('pool vazio não lança e reporta dados insuficientes nas quatro medições', () => {
    const resumo = calibrar([], REF);

    expect(resumo.meiaVida.valorRecomendado).toBeUndefined();
    expect(resumo.fatorCerco.valorRecomendado).toBeUndefined();
    for (const r of resumo.minimoPorNivel) expect(r.valorRecomendado).toBeUndefined();
    for (const r of resumo.zonaMorta) {
      expect(r.base.valorRecomendado).toBeUndefined();
      expect(r.derivaMensal.valorRecomendado).toBeUndefined();
    }
  });
});

/* O aviso é o que transforma o cron mensal em algo útil: sem ele o job
   mediria para um log que ninguém abre. O que se protege aqui é o critério de
   disparo — avisar de menos perde a decisão devida, avisar de mais treina o
   time a ignorar. */
describe('aviso de divergência (gatilho do cron)', () => {
  function resumoCom(parcial: Partial<ResumoCalibracao> = {}): ResumoCalibracao {
    return {
      meiaVida: { valorAtual: 30, amostrasAvaliadas: 0, detalhe: 'sem base', erroPorCandidata: [] },
      fatorCerco: {
        valorAtual: 1.5,
        amostrasAvaliadas: 0,
        detalhe: 'sem base',
        metricaPorCandidato: [],
      },
      minimoPorNivel: [],
      zonaMorta: [],
      ...parcial,
    };
  }

  it('sem base medida, não avisa nada', () => {
    const divergencias = divergenciasDeCalibracao(resumoCom());

    expect(divergencias).toEqual([]);
    expect(formatarAvisoCalibracao(divergencias)).toBeUndefined();
  });

  it('medição que CONFIRMA o valor vigente não vira aviso', () => {
    const divergencias = divergenciasDeCalibracao(
      resumoCom({
        meiaVida: {
          valorAtual: 30,
          valorRecomendado: 30,
          amostrasAvaliadas: 42,
          detalhe: 'meia-vida 30d: MAPE 6,0%',
          erroPorCandidata: [],
        },
      }),
    );

    expect(divergencias).toEqual([]);
  });

  it('medição que pede outro valor vira aviso com o de/para e o que fazer', () => {
    const divergencias = divergenciasDeCalibracao(
      resumoCom({
        meiaVida: {
          valorAtual: 30,
          valorRecomendado: 14,
          amostrasAvaliadas: 42,
          detalhe: 'meia-vida 14d: MAPE 4,1%',
          erroPorCandidata: [],
        },
      }),
    );

    expect(divergencias).toHaveLength(1);
    expect(divergencias[0]).toMatchObject({ valorAtual: 30, valorRecomendado: 14 });

    const aviso = formatarAvisoCalibracao(divergencias);
    expect(aviso).toContain('atual 30 → medido 14');
    expect(aviso).toContain('job:recalculo');
  });

  it('cada nível de escopo diverge por conta própria', () => {
    const divergencias = divergenciasDeCalibracao(
      resumoCom({
        minimoPorNivel: [
          {
            escopo: 'loja',
            valorAtual: 3,
            valorRecomendado: 3,
            amostrasAvaliadas: 9,
            detalhe: 'n=3 basta',
            amplitudePorCandidato: [],
          },
          {
            escopo: 'uf',
            valorAtual: 3,
            valorRecomendado: 20,
            amostrasAvaliadas: 9,
            detalhe: 'n=20 estabiliza',
            amplitudePorCandidato: [],
          },
        ],
      }),
    );

    expect(divergencias.map((d) => d.parametro)).toEqual(['mínimo de observações — uf']);
  });

  it('a zona morta do veredito também dispara o aviso, base e deriva separadas', () => {
    const divergencias = divergenciasDeCalibracao(
      resumoCom({
        zonaMorta: [
          {
            familia: 'outros',
            base: {
              valorAtual: 0.03,
              valorRecomendado: 0.05,
              amostrasAvaliadas: 11,
              detalhe: 'ruído de amostra pede 5%',
            },
            derivaMensal: {
              valorAtual: 0.01,
              valorRecomendado: 0.01,
              amostrasAvaliadas: 11,
              detalhe: 'confirma 1%/mês',
            },
          },
        ],
      }),
    );

    // Só a base diverge; a deriva confirmada não vira ruído.
    expect(divergencias.map((d) => d.parametro)).toEqual(['zona morta — outros (base)']);
  });
});
