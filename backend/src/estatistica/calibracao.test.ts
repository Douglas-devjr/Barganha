/**
 * Testes da FERRAMENTA de calibração — não da calibração.
 *
 * Não há pool real do beta ainda, então o que se verifica aqui é a MATEMÁTICA:
 * dado um mundo sintético cujo comportamento é conhecido de antemão, a
 * ferramenta aponta para o lado certo (meia-vida curta quando o preço mudou de
 * patamar, `k` coerente com a profundidade real das promoções, `n` maior no
 * nível mais disperso) e admite não saber quando falta base. Qual é o número
 * CERTO para o Barganha, só o beta responde.
 */

import { describe, expect, it } from 'vitest';

import { ZONA_MORTA_POR_FAMILIA } from '@barganha/shared';

import {
  agruparParaCalibracao,
  AMPLITUDE_RELATIVA_ALVO,
  BASE_MINIMA_ZONA_MORTA,
  calibrarFatorCerco,
  calibrarMeiaVida,
  calibrarMinimoObservacoes,
  calibrarZonaMorta,
  type GrupoCalibracao,
  type ResultadoZonaMorta,
} from './calibracao';
import type { ObservacaoParaAgregacao } from './tipos';

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

function grupo(
  observacoes: readonly ObservacaoParaAgregacao[],
  escopo: GrupoCalibracao['escopo'] = 'municipio',
  escopoId = 'SP:SAO PAULO',
): GrupoCalibracao {
  return { produtoCanonicoId: 'p1', unidadeBase: 'kg', escopo, escopoId, observacoes };
}

/** Ruído determinístico e reprodutível (nada de Math.random num teste). */
function criarRuido(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado * 1_664_525 + 1_013_904_223) >>> 0;
    return estado / 4_294_967_296; // 0..1
  };
}

describe('agruparParaCalibracao', () => {
  it('a mesma observação entra em loja, município e UF (agregação aninhada)', () => {
    const grupos = agruparParaCalibracao([obs(10, 1), obs(11, 2)]);
    expect(grupos.map((g) => g.escopo).sort()).toEqual(['loja', 'municipio', 'uf']);
    for (const g of grupos) expect(g.observacoes).toHaveLength(2);
  });

  it('separa por produto e unidade-base', () => {
    const outro: ObservacaoParaAgregacao = { ...obs(10, 1), produtoCanonicoId: 'p2' };
    const grupos = agruparParaCalibracao([obs(10, 1), outro]);
    expect(new Set(grupos.map((g) => g.produtoCanonicoId))).toEqual(new Set(['p1', 'p2']));
  });
});

describe('calibrarMeiaVida (backtest walk-forward)', () => {
  it('prefere meia-vida CURTA quando o preço mudou de patamar há pouco', () => {
    // Preço em 10 por meses e um degrau para 14 há 60 dias. O degrau cai ANTES
    // do corte treino/teste de propósito: as duas eras estão no treino, e o que
    // decide o acerto é o peso dado a cada uma — que é o parâmetro em teste.
    const observacoes: ObservacaoParaAgregacao[] = [];
    for (let d = 170; d >= 60; d -= 1) observacoes.push(obs(10, d));
    for (let d = 59; d >= 0; d -= 1) observacoes.push(obs(14, d));

    const r = calibrarMeiaVida([grupo(observacoes)], { referencia: REF });

    expect(r.valorAtual).toBe(30);
    expect(r.amostrasAvaliadas).toBe(1);
    expect(r.valorRecomendado).toBeDefined();
    expect(r.valorRecomendado!).toBeLessThanOrEqual(30);
    const erro = (mv: number) => r.erroPorCandidata.find((e) => e.meiaVidaDias === mv)!.mapeMediano;
    expect(erro(7)).toBeLessThan(erro(120));
  });

  it('prefere meia-vida LONGA quando o preço é estável e barulhento', () => {
    // Sem tendência, mais história = estimativa menos sujeita ao ruído.
    const ruido = criarRuido(7);
    const observacoes: ObservacaoParaAgregacao[] = [];
    for (let d = 170; d >= 0; d -= 2) observacoes.push(obs(10 + (ruido() - 0.5) * 6, d));

    const r = calibrarMeiaVida([grupo(observacoes)], { referencia: REF });

    const erro = (mv: number) => r.erroPorCandidata.find((e) => e.meiaVidaDias === mv)!.mapeMediano;
    expect(erro(120)).toBeLessThan(erro(7));
    expect(r.valorRecomendado!).toBeGreaterThanOrEqual(30);
  });

  it('sem histórico suficiente, não recomenda nada (não inventa número)', () => {
    const r = calibrarMeiaVida([grupo([obs(10, 5), obs(11, 3), obs(12, 1)])], { referencia: REF });
    expect(r.valorRecomendado).toBeUndefined();
    expect(r.amostrasAvaliadas).toBe(0);
    expect(r.detalhe).toContain('sem base');
  });

  it('lista vazia é resultado válido, não exceção', () => {
    expect(() => calibrarMeiaVida([], { referencia: REF })).not.toThrow();
    expect(calibrarMeiaVida([], { referencia: REF }).valorRecomendado).toBeUndefined();
  });
});

describe('calibrarFatorCerco (recall vs. falso-positivo)', () => {
  // 20 regulares de 10,00 a 11,90, todos na MESMA data — peso temporal 1, então
  // o percentil ponderado vira o clássico e o p25/p75 é calculável à mão:
  // p25 = 10,45 · p75 = 11,45 · IQR = 1,00.
  const regulares = Array.from({ length: 20 }, (_, i) => obs(10 + i * 0.1, 10));
  const Q1 = 10.45;
  const IQR = 1;

  it('recomenda um k que alcança promoções declaradas a 1,2×IQR abaixo do p25', () => {
    const declaradas = [
      obs(Q1 - 1.2 * IQR, 10, true),
      obs(Q1 - 1.3 * IQR, 10, true),
      obs(Q1 - 1.4 * IQR, 10, true),
    ];

    const r = calibrarFatorCerco([grupo([...regulares, ...declaradas])], { referencia: REF });

    expect(r.valorAtual).toBe(1.5);
    expect(r.amostrasAvaliadas).toBe(1);
    // Só k ≤ 1 cerca promoções a 1,2×IQR; e não há regular lá embaixo, logo FP 0.
    expect(r.valorRecomendado).toBe(1);
    const m = r.metricaPorCandidato.find((x) => x.fator === 1)!;
    expect(m.recallMediano).toBe(1);
    expect(m.fpMedianoRegular).toBe(0);
    // O k vigente (1,5) não pegaria nenhuma dessas — é isso que a medição revela.
    expect(r.metricaPorCandidato.find((x) => x.fator === 1.5)!.recallMediano).toBe(0);
  });

  it('o teto de falso-positivo empurra o k para cima quando há regular barato', () => {
    // Com dois regulares a 9,00 o p25/IQR viram 10,30/1,10: o cerco de k=1
    // (9,20) os pegaria — 9% de falso-positivo, acima do teto de 5% — enquanto o
    // de k=1,5 (8,65) não. As promoções declaradas ficam abaixo de 8,65.
    const regularesBaratos = [obs(9, 10), obs(9, 10)];
    const declaradas = [obs(8, 10, true), obs(8.2, 10, true)];

    const r = calibrarFatorCerco([grupo([...regulares, ...regularesBaratos, ...declaradas])], {
      referencia: REF,
    });

    expect(r.metricaPorCandidato.find((x) => x.fator === 1)!.fpMedianoRegular).toBeGreaterThan(
      0.05,
    );
    expect(r.valorRecomendado).toBe(1.5);
    const escolhido = r.metricaPorCandidato.find((x) => x.fator === r.valorRecomendado)!;
    expect(escolhido.fpMedianoRegular).toBeLessThanOrEqual(0.05);
    expect(escolhido.recallMediano).toBeGreaterThanOrEqual(0.5);
  });

  it('sem promoção declarada, não recomenda nada', () => {
    const r = calibrarFatorCerco([grupo(regulares)], { referencia: REF });
    expect(r.valorRecomendado).toBeUndefined();
    expect(r.amostrasAvaliadas).toBe(0);
    expect(r.detalhe).toContain('sem base');
  });
});

describe('calibrarMinimoObservacoes (bootstrap por nível)', () => {
  /** Pool de `n` preços espalhados em ±`dispersao` em torno de 10, mesma data. */
  function pool(n: number, dispersao: number, semente: number): ObservacaoParaAgregacao[] {
    const ruido = criarRuido(semente);
    return Array.from({ length: n }, () => obs(10 * (1 + (ruido() - 0.5) * 2 * dispersao), 5));
  }

  it('pede n MAIOR no nível mais disperso (loja apertada vs. UF espalhada)', () => {
    const grupos = [
      grupo(pool(60, 0.02, 11), 'loja', '11111111000191'),
      grupo(pool(60, 0.6, 22), 'uf', 'SP'),
    ];

    const resultados = calibrarMinimoObservacoes(grupos, { referencia: REF });
    const porNivel = new Map(resultados.map((r) => [r.escopo, r]));

    expect(resultados).toHaveLength(4); // sempre uma linha por nível
    const loja = porNivel.get('loja')!;
    const uf = porNivel.get('uf')!;
    expect(loja.valorRecomendado).toBeDefined();
    expect(uf.valorRecomendado).toBeDefined();
    expect(uf.valorRecomendado!).toBeGreaterThan(loja.valorRecomendado!);
    // E o n escolhido de fato cumpre o alvo de estabilidade.
    for (const r of [loja, uf]) {
      const escolhido = r.amplitudePorCandidato.find((a) => a.n === r.valorRecomendado)!;
      expect(escolhido.amplitudeRelativa).toBeLessThanOrEqual(AMPLITUDE_RELATIVA_ALVO);
    }
  });

  it('nível sem pool grande fica sem recomendação, sem apagar os outros níveis', () => {
    const resultados = calibrarMinimoObservacoes(
      [
        grupo(pool(60, 0.02, 33), 'municipio', 'SP:SAO PAULO'),
        grupo(pool(5, 0.1, 44), 'loja', 'x'),
      ],
      { referencia: REF },
    );
    const porNivel = new Map(resultados.map((r) => [r.escopo, r]));

    expect(porNivel.get('municipio')!.valorRecomendado).toBeDefined();
    expect(porNivel.get('loja')!.valorRecomendado).toBeUndefined();
    expect(porNivel.get('loja')!.amostrasAvaliadas).toBe(0);
    expect(porNivel.get('loja')!.detalhe).toContain('sem base');
    expect(porNivel.get('regiao')!.valorRecomendado).toBeUndefined();
  });

  it('é determinístico: duas rodadas sobre a mesma base dão a mesma recomendação', () => {
    const grupos = [grupo(pool(60, 0.3, 55), 'municipio', 'SP:SAO PAULO')];
    const a = calibrarMinimoObservacoes(grupos, { referencia: REF });
    const b = calibrarMinimoObservacoes(grupos, { referencia: REF });
    expect(a.map((r) => r.valorRecomendado)).toEqual(b.map((r) => r.valorRecomendado));
  });

  it('base vazia não lança e mantém o valor atual como referência', () => {
    const resultados = calibrarMinimoObservacoes([], { referencia: REF });
    expect(resultados).toHaveLength(4);
    for (const r of resultados) {
      expect(r.valorRecomendado).toBeUndefined();
      expect(r.valorAtual).toBe(3);
    }
  });
});

describe('calibrarZonaMorta (base e deriva por família — C3.6)', () => {
  /** Observação de um produto específico (a família sai da categoria dele). */
  function obsDe(
    produtoCanonicoId: string,
    preco: number,
    diasAtras: number,
    emPromocao = false,
  ): ObservacaoParaAgregacao {
    return { ...obs(preco, diasAtras, emPromocao), produtoCanonicoId };
  }

  function grupoDe(
    produtoCanonicoId: string,
    observacoes: readonly ObservacaoParaAgregacao[],
    escopo: GrupoCalibracao['escopo'] = 'municipio',
  ): GrupoCalibracao {
    return {
      produtoCanonicoId,
      unidadeBase: 'kg',
      escopo,
      escopoId: 'SP:SAO PAULO',
      observacoes,
    };
  }

  /**
   * Pool de `n` preços espalhados no tempo (150 → 5 dias atrás), subindo
   * `taxaMensal` ao mês e com `dispersao` de ruído entre lojas.
   */
  function poolNoTempo(
    produtoCanonicoId: string,
    n: number,
    taxaMensal: number,
    dispersao: number,
    semente: number,
  ): ObservacaoParaAgregacao[] {
    const ruido = criarRuido(semente);
    return Array.from({ length: n }, (_, i) => {
      const diasAtras = 150 - (145 * i) / (n - 1);
      const meses = (150 - diasAtras) / 30.44;
      const base = 10 * Math.pow(1 + taxaMensal, meses);
      return obsDe(produtoCanonicoId, base * (1 + (ruido() - 0.5) * 2 * dispersao), diasAtras);
    });
  }

  const CATEGORIAS = new Map([
    ['tomate', 'Hortifruti'],
    ['cafe', 'Mercearia'],
  ]);

  function porFamilia(resultados: readonly ResultadoZonaMorta[]) {
    return new Map(resultados.map((r) => [r.familia, r]));
  }

  it('mede deriva MAIOR na família cujo preço de fato andou mais', () => {
    // Tomate subindo ~3%/mês, café praticamente parado — a diferença que a
    // etapa existe para capturar.
    const grupos = [
      grupoDe('tomate', poolNoTempo('tomate', 40, 0.03, 0.05, 7)),
      grupoDe('cafe', poolNoTempo('cafe', 40, 0.001, 0.05, 8)),
    ];

    const r = porFamilia(
      calibrarZonaMorta(grupos, { referencia: REF, categoriaPorProduto: CATEGORIAS }),
    );

    const fresco = r.get('fresco')!.derivaMensal;
    const industrializado = r.get('industrializado')!.derivaMensal;
    expect(fresco.valorRecomendado).toBeDefined();
    expect(industrializado.valorRecomendado).toBeDefined();
    expect(fresco.valorRecomendado!).toBeGreaterThan(industrializado.valorRecomendado!);
    // O preço parado não puxa a deriva para cima só porque existe.
    expect(industrializado.valorRecomendado!).toBeLessThanOrEqual(0.008);
  });

  it('a base não desce abaixo do piso de percepção, por mais firme que o típico seja', () => {
    // Preço idêntico em todas as lojas: ruído de amostra ~0. Ainda assim a base
    // fica em 5% — esse pedaço vem do ser humano, não do pool.
    const grupos = [grupoDe('cafe', poolNoTempo('cafe', 40, 0, 0.001, 9))];
    const r = porFamilia(
      calibrarZonaMorta(grupos, { referencia: REF, categoriaPorProduto: CATEGORIAS }),
    );
    expect(r.get('industrializado')!.base.valorRecomendado).toBe(BASE_MINIMA_ZONA_MORTA);
  });

  it('a base SOBE quando a mediana da família balança mais que o piso', () => {
    // Pool muito disperso: com célula de 8 observações a própria mediana passeia,
    // e opinar dentro desse passeio é ler ruído.
    const grupos = [grupoDe('tomate', poolNoTempo('tomate', 60, 0, 0.4, 10))];
    const r = porFamilia(
      calibrarZonaMorta(grupos, { referencia: REF, categoriaPorProduto: CATEGORIAS }),
    );
    const base = r.get('fresco')!.base;
    expect(base.valorRecomendado).toBeDefined();
    expect(base.valorRecomendado!).toBeGreaterThan(BASE_MINIMA_ZONA_MORTA);
  });

  it('dispersão absurda não vira zona morta absurda: acusa o casamento de produto', () => {
    // ±80% no mesmo canônico não é mercado caro, é marca/tamanho misturado
    // (docs/06). A ferramenta se recusa a recomendar e diz onde está o problema.
    const grupos = [grupoDe('tomate', poolNoTempo('tomate', 60, 0, 0.8, 16))];
    const base = porFamilia(
      calibrarZonaMorta(grupos, { referencia: REF, categoriaPorProduto: CATEGORIAS }),
    ).get('fresco')!.base;
    expect(base.valorRecomendado).toBeUndefined();
    expect(base.detalhe).toContain('casamento de produto');
  });

  it('produto sem categoria é medido como `outros`, que é como o app o trata', () => {
    const grupos = [grupoDe('sem-catalogo', poolNoTempo('sem-catalogo', 40, 0.001, 0.05, 11))];
    const r = porFamilia(calibrarZonaMorta(grupos, { referencia: REF }));
    expect(r.get('outros')!.base.amostrasAvaliadas).toBe(1);
    expect(r.get('fresco')!.base.amostrasAvaliadas).toBe(0);
  });

  it('família sem base fica sem recomendação, sem apagar as outras', () => {
    const grupos = [grupoDe('tomate', poolNoTempo('tomate', 40, 0.02, 0.05, 12))];
    const resultados = calibrarZonaMorta(grupos, {
      referencia: REF,
      categoriaPorProduto: CATEGORIAS,
    });
    const r = porFamilia(resultados);

    expect(resultados).toHaveLength(3); // sempre uma linha por família
    expect(r.get('fresco')!.base.valorRecomendado).toBeDefined();
    const industrializado = r.get('industrializado')!;
    expect(industrializado.base.valorRecomendado).toBeUndefined();
    expect(industrializado.base.amostrasAvaliadas).toBe(0);
    expect(industrializado.base.detalhe).toContain('sem base');
    // E o valor vigente continua sendo a referência exibida.
    expect(industrializado.base.valorAtual).toBe(ZONA_MORTA_POR_FAMILIA.industrializado.base);
  });

  it('só o nível município entra — a mesma observação não conta quatro vezes', () => {
    const observacoes = poolNoTempo('tomate', 40, 0.02, 0.05, 13);
    const soLoja = calibrarZonaMorta([grupoDe('tomate', observacoes, 'loja')], {
      referencia: REF,
      categoriaPorProduto: CATEGORIAS,
    });
    expect(porFamilia(soLoja).get('fresco')!.base.amostrasAvaliadas).toBe(0);

    // E o pipeline real (que deriva loja+município+UF da mesma observação) conta 1.
    const derivados = agruparParaCalibracao(observacoes);
    const r = calibrarZonaMorta(derivados, { referencia: REF, categoriaPorProduto: CATEGORIAS });
    expect(porFamilia(r).get('fresco')!.base.amostrasAvaliadas).toBe(1);
  });

  it('promoção declarada não entra: o típico é regular, e a zona morta cerca o típico', () => {
    const regulares = poolNoTempo('cafe', 40, 0.001, 0.02, 14);
    const comPromo = [
      ...regulares,
      ...Array.from({ length: 20 }, (_, i) => obsDe('cafe', 4, 140 - i * 6, true)),
    ];
    const semPromo = calibrarZonaMorta([grupoDe('cafe', regulares)], {
      referencia: REF,
      categoriaPorProduto: CATEGORIAS,
    });
    const comPromoR = calibrarZonaMorta([grupoDe('cafe', comPromo)], {
      referencia: REF,
      categoriaPorProduto: CATEGORIAS,
    });
    expect(porFamilia(comPromoR).get('industrializado')!.base.valorRecomendado).toBe(
      porFamilia(semPromo).get('industrializado')!.base.valorRecomendado,
    );
  });

  it('é determinístico e não lança sobre base vazia', () => {
    const grupos = [grupoDe('tomate', poolNoTempo('tomate', 40, 0.02, 0.2, 15))];
    const a = calibrarZonaMorta(grupos, { referencia: REF, categoriaPorProduto: CATEGORIAS });
    const b = calibrarZonaMorta(grupos, { referencia: REF, categoriaPorProduto: CATEGORIAS });
    expect(a).toEqual(b);

    const vazio = calibrarZonaMorta([], { referencia: REF });
    expect(vazio).toHaveLength(3);
    for (const r of vazio) {
      expect(r.base.valorRecomendado).toBeUndefined();
      expect(r.derivaMensal.valorRecomendado).toBeUndefined();
    }
  });
});
