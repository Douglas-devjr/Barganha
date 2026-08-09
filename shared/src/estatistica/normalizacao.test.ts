import { describe, expect, it } from 'vitest';

import {
  MAPA_UNIDADES,
  UNIDADES_EMBALAGEM_MULTIPLA,
  UNIDADES_NAO_COMPARAVEIS,
  chaveMunicipio,
  itensPorEmbalagem,
  normalizarDescricao,
  normalizarPreco,
  precoUnitarioEfetivo,
  resolverUnidade,
  unidadeConhecida,
  unidadePadraoDaBase,
} from './normalizacao';

describe('precoUnitarioEfetivo (shared)', () => {
  it('sem desconto: devolve o próprio unitário', () => {
    expect(precoUnitarioEfetivo({ valorUnitario: 5.29, quantidade: 1 })).toBe(5.29);
    expect(precoUnitarioEfetivo({ valorUnitario: 5.29, quantidade: 1, desconto: 0 })).toBe(5.29);
  });

  it('com desconto: rateia o desconto TOTAL do item pela quantidade', () => {
    expect(precoUnitarioEfetivo({ valorUnitario: 5.29, quantidade: 1, desconto: 0.5 })).toBeCloseTo(
      4.79,
      10,
    );
    expect(precoUnitarioEfetivo({ valorUnitario: 10, quantidade: 2, desconto: 1 })).toBe(9.5);
  });

  it('quantidade inválida (0/NaN): não divide, devolve o unitário', () => {
    expect(precoUnitarioEfetivo({ valorUnitario: 10, quantidade: 0, desconto: 1 })).toBe(10);
    expect(precoUnitarioEfetivo({ valorUnitario: 10, quantidade: Number.NaN, desconto: 1 })).toBe(
      10,
    );
  });

  it('desconto maior que o item: resultado ≤ 0 (rejeitado adiante pelo normalizarPreco)', () => {
    const efetivo = precoUnitarioEfetivo({ valorUnitario: 2, quantidade: 1, desconto: 3 });
    expect(efetivo).toBeLessThanOrEqual(0);
    expect(normalizarPreco({ unidade: 'UN', valorUnitario: efetivo })).toBeUndefined();
  });
});

describe('normalizarPreco (shared)', () => {
  it('mantém KG como R$/kg (fator 1)', () => {
    expect(normalizarPreco({ unidade: 'KG', valorUnitario: 32.9 })).toEqual({
      unidadeBase: 'kg',
      precoNormalizado: 32.9,
    });
  });

  it('converte G para R$/kg (×1000)', () => {
    expect(normalizarPreco({ unidade: 'G', valorUnitario: 0.0329 })).toEqual({
      unidadeBase: 'kg',
      precoNormalizado: 32.9,
    });
  });

  it('converte ml para R$/L (×1000)', () => {
    expect(normalizarPreco({ unidade: 'ml', valorUnitario: 0.005 })).toEqual({
      unidadeBase: 'L',
      precoNormalizado: 5,
    });
  });

  it('trata UN como R$/un', () => {
    expect(normalizarPreco({ unidade: 'UN', valorUnitario: 4.79 })).toMatchObject({
      unidadeBase: 'un',
      precoNormalizado: 4.79,
    });
  });

  it('converte DZ para R$/un (÷12)', () => {
    expect(normalizarPreco({ unidade: 'DZ', valorUnitario: 12 })).toEqual({
      unidadeBase: 'un',
      precoNormalizado: 1,
    });
  });

  it('trata embalagens de UM volume (bandeja, pote, pacote, garrafa…) como R$/un', () => {
    const unitarias = [
      'BJ',
      'BDJ',
      'BANDEJA',
      'EV',
      'ENVELOPE',
      'FR',
      'FRASCO',
      'PT',
      'POTE',
      'PCT',
      'PCTE',
      'PACOTE',
      'PAC',
      'SC',
      'SACO',
      'GF',
      'GFA',
      'GRF',
      'GARRAFA',
      'LATA',
      'LTA',
      'VD',
      'VIDRO',
      'TB',
      'TUBO',
      'RL',
      'ROLO',
      'PC',
      'PÇ',
      'PECA',
    ];
    for (const unidade of unitarias) {
      expect(normalizarPreco({ unidade, valorUnitario: 9.98 }), unidade).toEqual({
        unidadeBase: 'un',
        precoNormalizado: 9.98,
      });
    }
  });

  it('absorve pontuação e acento da unidade ("un.", "Pç", "kg")', () => {
    for (const unidade of ['un.', ' UN ', 'Un', 'Pç', 'PÇ.']) {
      expect(normalizarPreco({ unidade, valorUnitario: 4.79 }), unidade).toEqual({
        unidadeBase: 'un',
        precoNormalizado: 4.79,
      });
    }
    expect(normalizarPreco({ unidade: 'Kg.', valorUnitario: 32.9 })).toMatchObject({
      unidadeBase: 'kg',
    });
  });

  it('rejeita unidade desconhecida (fora do pool)', () => {
    expect(normalizarPreco({ unidade: 'XPTO', valorUnitario: 10 })).toBeUndefined();
    expect(normalizarPreco({ unidade: '', valorUnitario: 10 })).toBeUndefined();
  });

  it('rejeita preço inválido', () => {
    expect(normalizarPreco({ unidade: 'KG', valorUnitario: 0 })).toBeUndefined();
  });
});

describe('itensPorEmbalagem (C3.4)', () => {
  it('lê a contagem de "N × tamanho"', () => {
    expect(itensPorEmbalagem('CERVEJA BRAHMA 350ML 12X350ML')).toBe(12);
    expect(itensPorEmbalagem('Água Mineral 6 x 1,5 L')).toBe(6);
    expect(itensPorEmbalagem('SABAO EM PO OMO 12X500G')).toBe(12);
  });

  it('lê a contagem declarada em unidades', () => {
    expect(itensPorEmbalagem('OVO BRANCO GRANDE 30UN')).toBe(30);
    expect(itensPorEmbalagem('IOGURTE MORANGO CX 6 UNIDADES')).toBe(6);
  });

  it('lê a contagem marcada por caixa/fardo/pacote', () => {
    expect(itensPorEmbalagem('REFRIGERANTE COLA 2L FD 6')).toBe(6);
    expect(itensPorEmbalagem('LEITE INTEGRAL 1L C/12')).toBe(12);
    expect(itensPorEmbalagem('CAFE TORRADO CX 24')).toBe(24);
  });

  it('não confunde TAMANHO com contagem', () => {
    // O clássico: caixa de 5 kg é UM volume de 5 kg, não 5 unidades.
    expect(itensPorEmbalagem('ARROZ TIPO 1 CX 5KG')).toBeUndefined();
    expect(itensPorEmbalagem('DETERGENTE CX 500ML')).toBeUndefined();
    expect(itensPorEmbalagem('PAPEL SULFITE CX 20X30CM')).toBeUndefined();
  });

  it('ignora contagem fora da faixa sã (1 ou absurda)', () => {
    expect(itensPorEmbalagem('BOLACHA PCT 1')).toBeUndefined();
    expect(itensPorEmbalagem('PARAFUSO CX 500')).toBeUndefined();
  });

  it('ignora descrição sem contagem alguma', () => {
    expect(itensPorEmbalagem('CAFE TORRADO 500G')).toBeUndefined();
    expect(itensPorEmbalagem('SHAMPOO 2 EM 1 400ML')).toBeUndefined();
  });
});

describe('normalizarPreco — embalagem múltipla (C3.4)', () => {
  it('caixa/fardo com contagem na descrição vira R$/un do item de dentro', () => {
    expect(
      normalizarPreco({ unidade: 'CX', valorUnitario: 48, descricao: 'CERVEJA LATA 12X350ML' }),
    ).toEqual({ unidadeBase: 'un', precoNormalizado: 4 });
    expect(
      normalizarPreco({ unidade: 'FD', valorUnitario: 36, descricao: 'REFRIGERANTE 2L FD 6' }),
    ).toEqual({ unidadeBase: 'un', precoNormalizado: 6 });
  });

  it('aceita a contagem colada na própria unidade ("CX12", "PCT 6")', () => {
    expect(normalizarPreco({ unidade: 'CX12', valorUnitario: 48 })).toEqual({
      unidadeBase: 'un',
      precoNormalizado: 4,
    });
    // Unidade de um volume + contagem colada: o pacote É de 6 (ex.: PCT6).
    expect(normalizarPreco({ unidade: 'PCT 6', valorUnitario: 12 })).toEqual({
      unidadeBase: 'un',
      precoNormalizado: 2,
    });
  });

  it('SEM contagem, caixa e fardo seguem fora do pool (conservador)', () => {
    expect(normalizarPreco({ unidade: 'CX', valorUnitario: 48 })).toBeUndefined();
    expect(
      normalizarPreco({ unidade: 'FARDO', valorUnitario: 48, descricao: 'ARROZ TIPO 1 5KG' }),
    ).toBeUndefined();
  });

  it('não divide KIT/CONJUNTO (conteúdo heterogêneo, não comparável)', () => {
    expect(
      normalizarPreco({ unidade: 'KIT', valorUnitario: 30, descricao: 'KIT SHAMPOO 2X350ML' }),
    ).toBeUndefined();
  });

  it('a descrição NUNCA muda o fator de uma unidade de fator fixo', () => {
    // Invariante que impede app e backend de divergirem: passar (ou esquecer) a
    // descrição só destrava embalagem múltipla — jamais altera KG/L/UN.
    const comDescricao = normalizarPreco({
      unidade: 'UN',
      valorUnitario: 5.49,
      descricao: 'LEITE INTEGRAL 1L C/12',
    });
    expect(comDescricao).toEqual(normalizarPreco({ unidade: 'UN', valorUnitario: 5.49 }));
    expect(comDescricao).toEqual({ unidadeBase: 'un', precoNormalizado: 5.49 });
  });

  it('resolverUnidade expõe o fator resolvido', () => {
    expect(resolverUnidade('CX', 'CERVEJA 12X350ML')).toEqual({ base: 'un', fator: 1 / 12 });
    expect(resolverUnidade('KG')).toEqual({ base: 'kg', fator: 1 });
    expect(resolverUnidade('CX')).toBeUndefined();
  });
});

describe('plural das unidades (C3.4)', () => {
  it('o "S" do plural não faz o item cair do pool', () => {
    expect(normalizarPreco({ unidade: 'KGS', valorUnitario: 12 })).toEqual({
      unidadeBase: 'kg',
      precoNormalizado: 12,
    });
    expect(normalizarPreco({ unidade: 'LATAS', valorUnitario: 3.5 })).toEqual({
      unidadeBase: 'un',
      precoNormalizado: 3.5,
    });
    expect(normalizarPreco({ unidade: 'GRAMAS', valorUnitario: 0.05 })).toEqual({
      unidadeBase: 'kg',
      precoNormalizado: 50,
    });
  });

  it('vale também para embalagem múltipla', () => {
    expect(
      normalizarPreco({ unidade: 'CAIXAS', valorUnitario: 48, descricao: 'CERVEJA 12X350ML' }),
    ).toEqual({ unidadeBase: 'un', precoNormalizado: 4 });
  });

  it('unidade legítima terminada em S é lida crua, não mutilada', () => {
    // "GRS" existe como grama e resolve pelo plural; o que não pode acontecer é
    // uma chave do mapa perder o próprio "S" antes de ser tentada inteira.
    expect(resolverUnidade('GRS')).toEqual({ base: 'kg', fator: 1000 });
    expect(resolverUnidade('S')).toBeUndefined();
  });
});

describe('unidadeConhecida (C3.4 — telemetria de ingestão)', () => {
  it('unidade direta e prefixo de embalagem múltipla são conhecidos', () => {
    expect(unidadeConhecida('KG')).toBe(true);
    expect(unidadeConhecida('un.')).toBe(true); // pontuação/caixa não importa
    expect(unidadeConhecida('CX')).toBe(true); // sem contagem, mas o prefixo é sabido
    expect(unidadeConhecida('PCT12')).toBe(true); // contagem colada num prefixo sabido
    expect(unidadeConhecida('FARDOS')).toBe(true); // plural
  });

  it('unidade NÃO-COMPARÁVEL é conhecida — fica fora do pool sem virar "lacuna"', () => {
    // O ponto da lista: sem ela, estas quatro liderariam para sempre o ranking
    // de "abreviação que falta", e o contador nunca chegaria a zero.
    for (const unidade of ['M2', 'KIT', 'PAR', 'MT']) {
      expect(unidadeConhecida(unidade)).toBe(true);
      expect(normalizarPreco({ unidade, valorUnitario: 10 })).toBeUndefined();
    }
  });

  it('abreviação nunca vista pelo mapa não é conhecida', () => {
    expect(unidadeConhecida('XPTO')).toBe(false);
    expect(unidadeConhecida('')).toBe(false);
  });
});

describe('as três listas de unidades são disjuntas (C3.4)', () => {
  it('nenhuma chave aparece em duas listas', () => {
    const comparaveis = Object.keys(MAPA_UNIDADES);
    const multiplas = [...UNIDADES_EMBALAGEM_MULTIPLA];
    const foraPorNatureza = [...UNIDADES_NAO_COMPARAVEIS];
    const todas = [...comparaveis, ...multiplas, ...foraPorNatureza];

    // Uma chave em duas listas é decisão silenciosamente contraditória: a ordem
    // de consulta passaria a decidir se o item entra no pool.
    expect(todas).toHaveLength(new Set(todas).size);
  });

  it('nenhuma chave é o plural de outra (o "S" as tornaria intercambiáveis)', () => {
    const todas = [
      ...Object.keys(MAPA_UNIDADES),
      ...UNIDADES_EMBALAGEM_MULTIPLA,
      ...UNIDADES_NAO_COMPARAVEIS,
    ];
    const redundantes = todas.filter((c) => c.endsWith('S') && todas.includes(c.slice(0, -1)));
    expect(redundantes).toEqual([]);
  });
});

describe('unidadePadraoDaBase', () => {
  it('mapeia cada base para sua unidade de venda canônica', () => {
    expect(unidadePadraoDaBase('kg')).toBe('KG');
    expect(unidadePadraoDaBase('L')).toBe('L');
    expect(unidadePadraoDaBase('un')).toBe('UN');
  });

  it('compõe com normalizarPreco mantendo o valor (fator 1)', () => {
    expect(normalizarPreco({ unidade: unidadePadraoDaBase('un'), valorUnitario: 7.9 })).toEqual({
      unidadeBase: 'un',
      precoNormalizado: 7.9,
    });
  });
});

describe('normalizarDescricao', () => {
  it('remove acentos, sobe a caixa e colapsa espaços', () => {
    expect(normalizarDescricao('  Café   Pilão  Torrado ')).toBe('CAFE PILAO TORRADO');
  });
});

describe('chaveMunicipio', () => {
  it('monta UF:MUNICIPIO normalizado (sem acento, maiúsculas)', () => {
    expect(chaveMunicipio('RJ', 'Rio de Janeiro')).toBe('RJ:RIO DE JANEIRO');
    expect(chaveMunicipio('SP', 'São Paulo')).toBe('SP:SAO PAULO');
  });

  it('casa a forma do parser (caixa alta) com a do seletor (mista)', () => {
    // O parser grava "SAO PAULO"; o usuário escolhe "São Paulo" — mesma chave.
    expect(chaveMunicipio('sp', 'SAO PAULO')).toBe(chaveMunicipio('SP', 'São Paulo'));
  });

  it('devolve vazio quando falta UF ou município', () => {
    expect(chaveMunicipio('', 'Rio de Janeiro')).toBe('');
    expect(chaveMunicipio('RJ', '   ')).toBe('');
  });
});
