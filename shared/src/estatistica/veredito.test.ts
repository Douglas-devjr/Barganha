import { describe, expect, it } from 'vitest';

import {
  classificarPreco,
  familiaDeCategoria,
  montarVeredito,
  parametrosZonaMorta,
  poucosDados,
  zonaMortaPara,
  type FaixaPreco,
} from './veredito';

const faixaRegional: FaixaPreco = {
  mediana: 6.5,
  p25: 6.0,
  p75: 7.0,
  menorPromocional: 5.0,
  nObservacoes: 12,
  unidadeBase: 'L',
  atualizadoEm: '2026-06-20T00:00:00.000Z',
};

describe('classificarPreco (C3.6)', () => {
  it('abaixo de p25 → barato', () => {
    expect(classificarPreco(5.5, faixaRegional)).toBe('barato');
  });

  it('entre p25 e p75 → na média', () => {
    expect(classificarPreco(6.5, faixaRegional)).toBe('na_media');
  });

  it('acima de p75 → caro', () => {
    expect(classificarPreco(7.9, faixaRegional)).toBe('caro');
  });

  it('NUNCA compara contra o menor promocional (R$5 é promoção, não o típico)', () => {
    // 6,40 está dentro da faixa regular; não pode virar "caro" por causa do R$5.
    expect(classificarPreco(6.4, faixaRegional)).toBe('na_media');
  });

  it('zona morta: diferença irrelevante vs. o típico é sempre "na média"', () => {
    // Produto homogêneo — toda loja cobra quase o mesmo, então p25 fica colado
    // na mediana. Sem a zona morta, R$ 0,05 de diferença virava "BARATO".
    const homogenea: FaixaPreco = {
      mediana: 8.0,
      p25: 7.95,
      p75: 8.05,
      nObservacoes: 20,
      unidadeBase: 'un',
      atualizadoEm: '2026-06-20T00:00:00.000Z',
    };
    expect(classificarPreco(7.9, homogenea)).toBe('na_media'); // −1,25%: abaixo do p25, mas irrelevante
    expect(classificarPreco(8.2, homogenea)).toBe('na_media'); // +2,5%: acima do p75, mas irrelevante
    // Passou dos 5% ­→ o percentil volta a mandar.
    expect(classificarPreco(7.5, homogenea)).toBe('barato'); // −6,25%
    expect(classificarPreco(8.5, homogenea)).toBe('caro'); // +6,25%
  });

  it('a zona morta não engole o sinal de produto disperso', () => {
    // Arroz: preço varia de verdade entre lojas. p25 já está a 12% da mediana,
    // bem além da zona morta — a regra de percentil segue intacta.
    const dispersa: FaixaPreco = {
      mediana: 25.0,
      p25: 22.0,
      p75: 29.0,
      nObservacoes: 18,
      unidadeBase: 'kg',
      atualizadoEm: '2026-06-20T00:00:00.000Z',
    };
    expect(classificarPreco(21.5, dispersa)).toBe('barato');
    expect(classificarPreco(30.0, dispersa)).toBe('caro');
    // E o meio da faixa continua "na média" mesmo longe da mediana: a dispersão
    // é real, e um % fixo sozinho chamaria isto de caro sem motivo.
    expect(classificarPreco(28.0, dispersa)).toBe('na_media'); // +12%, mas dentro do p75
  });

  it('sem percentis, cai para a banda ± em torno da mediana', () => {
    const semPercentis: FaixaPreco = {
      mediana: 10,
      nObservacoes: 4,
      unidadeBase: 'kg',
      atualizadoEm: '2026-06-20T00:00:00.000Z',
    };
    expect(classificarPreco(9, semPercentis)).toBe('barato'); // < 9,5
    expect(classificarPreco(10, semPercentis)).toBe('na_media');
    expect(classificarPreco(11, semPercentis)).toBe('caro'); // > 10,5
  });

  it('sem base nenhuma → sem_dados', () => {
    const vazio: FaixaPreco = {
      nObservacoes: 0,
      unidadeBase: 'un',
      atualizadoEm: '2026-06-20T00:00:00.000Z',
    };
    expect(classificarPreco(5, vazio)).toBe('sem_dados');
  });
});

describe('poucosDados (confiança)', () => {
  it('sinaliza quando a base é pequena', () => {
    expect(poucosDados({ ...faixaRegional, nObservacoes: 2 })).toBe(true);
    expect(poucosDados(faixaRegional)).toBe(false);
  });
});

describe('idade do típico no veredito (dado velho exige mais evidência)', () => {
  const AGORA = new Date('2026-07-29T12:00:00.000Z');
  const DIA_MS = 86_400_000;
  const diasAtras = (d: number) => new Date(AGORA.getTime() - d * DIA_MS).toISOString();

  /** Homogênea: p25/p75 colados na mediana, então a zona morta é quem decide. */
  const comIdade = (dias: number): FaixaPreco => ({
    mediana: 10,
    p25: 9.95,
    p75: 10.05,
    nObservacoes: 20,
    unidadeBase: 'un',
    atualizadoEm: AGORA.toISOString(),
    observadoEmMaisRecente: diasAtras(dias),
  });

  it('a zona morta cresce com a idade', () => {
    // Base 5% com dado de hoje; ~0,8% por mês de idade depois disso.
    expect(zonaMortaPara(comIdade(0), AGORA)).toBeCloseTo(0.05, 3);
    expect(zonaMortaPara(comIdade(91), AGORA)).toBeCloseTo(0.05 + 0.008 * 3, 2);
    expect(zonaMortaPara(comIdade(183), AGORA)).toBeCloseTo(0.05 + 0.008 * 6, 2);
  });

  it('a MESMA diferença é veredito com dado novo e "na média" com dado velho', () => {
    // −6% num típico fresco: passa dos 5% e o percentil manda → barato.
    expect(classificarPreco(9.4, comIdade(2), AGORA)).toBe('barato');
    // O mesmo −6% contra um típico de 5 meses cabe na deriva presumida: o app
    // deixa de cravar em vez de cravar errado.
    expect(classificarPreco(9.4, comIdade(150), AGORA)).toBe('na_media');
  });

  it('dado velho não emudece o app: diferença grande segue valendo', () => {
    // O ponto de NÃO suprimir por idade — 25% abaixo é sinal em qualquer idade.
    expect(classificarPreco(7.5, comIdade(150), AGORA)).toBe('barato');
    expect(classificarPreco(13, comIdade(150), AGORA)).toBe('caro');
  });

  it('passada a JANELA da agregação, não há veredito', () => {
    // Aos 181 dias o motor já descartaria a observação (MAX_IDADE_OBSERVACAO_DIAS).
    // O app não pode opinar sobre dado que nem existe mais para quem o calculou.
    expect(classificarPreco(7.5, comIdade(181), AGORA)).toBe('sem_dados');
    expect(classificarPreco(7.5, comIdade(179), AGORA)).not.toBe('sem_dados');
  });

  it('idade desconhecida é penalidade BRANDA, não silêncio', () => {
    // Cache anterior à coluna: se supuséssemos o pior, o app emudeceria durante a
    // transição inteira, quando nenhuma linha tem data ainda.
    const semData: FaixaPreco = { ...comIdade(0) };
    delete semData.observadoEmMaisRecente;
    expect(classificarPreco(7.5, semData, AGORA)).toBe('barato');
    expect(zonaMortaPara(semData, AGORA)).toBeLessThan(0.06);
  });

  it('o recálculo do servidor não rejuvenesce o veredito', () => {
    // `atualizadoEm` de hoje (varredura geral) com preço de 5 meses: se a idade
    // saísse do campo errado, a deriva sumiria e o app voltaria a cravar rótulos
    // sobre dado velho em massa.
    const recalculadoHoje: FaixaPreco = {
      ...comIdade(150),
      atualizadoEm: AGORA.toISOString(),
    };
    expect(classificarPreco(9.4, recalculadoHoje, AGORA)).toBe('na_media');
  });

  it('montarVeredito marca a ressalva de dado velho nos dois ângulos', () => {
    const v = montarVeredito({
      precoPrateleira: 7.5,
      regional: comIdade(90),
      pessoal: comIdade(2),
      referencia: AGORA,
    });
    expect(v.regional?.dadoVelho).toBe(true);
    expect(v.pessoal?.dadoVelho).toBe(false);
  });

  it('sem data, a ressalva aparece — desconhecido pede a mesma cautela', () => {
    const semData: FaixaPreco = { ...comIdade(0) };
    delete semData.observadoEmMaisRecente;
    const v = montarVeredito({ precoPrateleira: 7.5, regional: semData, referencia: AGORA });
    expect(v.regional?.dadoVelho).toBe(true);
  });
});

describe('zona morta por categoria (C3.6)', () => {
  const AGORA = new Date('2026-07-29T12:00:00.000Z');
  const DIA_MS = 86_400_000;

  const comCategoria = (categoria: string | undefined, dias: number): FaixaPreco => ({
    mediana: 10,
    p25: 9.95,
    p75: 10.05,
    nObservacoes: 20,
    unidadeBase: 'kg',
    atualizadoEm: AGORA.toISOString(),
    observadoEmMaisRecente: new Date(AGORA.getTime() - dias * DIA_MS).toISOString(),
    ...(categoria ? { categoria } : {}),
  });

  it('agrupa a categoria do catálogo na família de comportamento de preço', () => {
    expect(familiaDeCategoria('Hortifruti')).toBe('fresco');
    expect(familiaDeCategoria('Frutas')).toBe('fresco');
    expect(familiaDeCategoria('Carnes e Aves')).toBe('fresco');
    expect(familiaDeCategoria('Padaria')).toBe('fresco');
    expect(familiaDeCategoria('Bebidas')).toBe('industrializado');
    expect(familiaDeCategoria('Café')).toBe('industrializado'); // acento não atrapalha
    expect(familiaDeCategoria('Limpeza')).toBe('industrializado');
  });

  it('categoria ausente ou desconhecida cai no padrão, nunca num comportamento inventado', () => {
    expect(familiaDeCategoria(undefined)).toBe('outros');
    expect(familiaDeCategoria('')).toBe('outros');
    expect(familiaDeCategoria('Utilidades Domésticas')).toBe('outros');
    expect(parametrosZonaMorta(undefined)).toEqual(parametrosZonaMorta('Utilidades Domésticas'));
  });

  it('casa por PALAVRA, não por pedaço de palavra', () => {
    // O caso que a regra existe para evitar: "sabão" contendo as letras de "pão".
    expect(familiaDeCategoria('Sabao em po')).not.toBe('fresco');
    expect(familiaDeCategoria('Paes')).toBe('fresco');
    // E prefixo curto demais: cereal não é açougue por começar com "ave".
    expect(familiaDeCategoria('Aveia e Granola')).not.toBe('fresco');
    expect(familiaDeCategoria('Avela')).not.toBe('fresco');
    expect(familiaDeCategoria('Carnes e Aves')).toBe('fresco');
  });

  it('com dado de HOJE toda família decide igual — a base é a mesma', () => {
    expect(zonaMortaPara(comCategoria('Hortifruti', 0), AGORA)).toBeCloseTo(
      zonaMortaPara(comCategoria('Bebidas', 0), AGORA),
      4,
    );
    // E igual ao produto sem categoria: quem não tem categoria não muda de veredito.
    expect(zonaMortaPara(comCategoria(undefined, 0), AGORA)).toBeCloseTo(0.05, 4);
  });

  it('com típico VELHO, o fresco exige mais evidência que o industrializado', () => {
    // O ponto da etapa: alface é reprecificada toda semana, café não. Aos 3 meses
    // o típico de hortifruti descreve outro mercado.
    const fresco = zonaMortaPara(comCategoria('Hortifruti', 91), AGORA);
    const industrializado = zonaMortaPara(comCategoria('Café', 91), AGORA);
    expect(fresco).toBeGreaterThan(industrializado);
    expect(fresco).toBeCloseTo(0.05 + 0.02 * 3, 2);
    expect(industrializado).toBeCloseTo(0.05 + 0.008 * 3, 2);
  });

  it('a mesma diferença sobre dado velho: cala no fresco, crava no industrializado', () => {
    // −9% contra um típico de 3 meses. No café isso passa da zona morta (7,4%);
    // no hortifruti cabe dentro da deriva (11%) e o app prefere não cravar.
    expect(classificarPreco(9.1, comCategoria('Cafe', 91), AGORA)).toBe('barato');
    expect(classificarPreco(9.1, comCategoria('Hortifruti', 91), AGORA)).toBe('na_media');
  });

  it('nem no fresco a idade emudece o app: diferença grande segue valendo', () => {
    expect(classificarPreco(7.0, comCategoria('Hortifruti', 150), AGORA)).toBe('barato');
    expect(classificarPreco(14.0, comCategoria('Hortifruti', 150), AGORA)).toBe('caro');
  });

  it('montarVeredito respeita a categoria dos dois ângulos', () => {
    const v = montarVeredito({
      precoPrateleira: 9.1,
      regional: comCategoria('Hortifruti', 91),
      pessoal: comCategoria('Cafe', 91),
      referencia: AGORA,
    });
    expect(v.regional?.veredito).toBe('na_media');
    expect(v.pessoal?.veredito).toBe('barato');
  });
});

describe('montarVeredito (híbrido pessoal + regional)', () => {
  it('combina os dois mundos e separa a promoção numa linha à parte', () => {
    const pessoal: FaixaPreco = {
      mediana: 6.2,
      p25: 6.0,
      p75: 6.4,
      menorPromocional: 5.5,
      nObservacoes: 3,
      unidadeBase: 'L',
      atualizadoEm: '2026-06-10T00:00:00.000Z',
    };

    const v = montarVeredito({ precoPrateleira: 7.9, regional: faixaRegional, pessoal });

    expect(v.veredito).toBe('caro'); // destaque = regional
    expect(v.regional?.veredito).toBe('caro');
    expect(v.pessoal?.veredito).toBe('caro');
    // menor visto = o menor entre os dois mundos (R$5 da região).
    expect(v.promocao).toEqual({ menorVisto: 5.0, unidadeBase: 'L' });
  });

  it('quando não há região, o destaque cai para o pessoal', () => {
    const pessoal: FaixaPreco = {
      mediana: 6.2,
      p25: 6.0,
      p75: 6.4,
      nObservacoes: 5,
      unidadeBase: 'L',
      atualizadoEm: '2026-06-10T00:00:00.000Z',
    };
    const v = montarVeredito({ precoPrateleira: 5.0, pessoal });
    expect(v.veredito).toBe('barato');
    expect(v.regional).toBeUndefined();
    expect(v.promocao).toBeUndefined();
  });

  it('sem nenhum mundo → sem_dados', () => {
    expect(montarVeredito({ precoPrateleira: 5 }).veredito).toBe('sem_dados');
  });
});
