import { describe, expect, it } from 'vitest';

import {
  GRAFICO_GRATIS_DIAS,
  HISTORICO_GRATIS_MESES,
  LIMITES_GRATIS,
  NUNCA_COBRAVEL,
  PLANO_PADRAO,
  RECURSOS,
  aplicarTeto,
  dentroDoGrafico,
  dentroDoHistorico,
  ePlano,
  inicioDoGrafico,
  inicioDoHistorico,
  limiteDe,
  podeAdicionar,
  podeUsar,
} from './direitos';

const AGORA = new Date('2026-07-31T12:00:00.000Z');

describe('as duas regras travadas (docs/21)', () => {
  it('nada que alimente o pool ou julgue preço é cobrável', () => {
    // Esta é a trava. Mover um item de NUNCA_COBRAVEL para RECURSOS quebra aqui,
    // e é para quebrar: o veredito é o mesmo para quem paga e quem não paga.
    const pagos: readonly string[] = RECURSOS;
    for (const livre of NUNCA_COBRAVEL) {
      expect(pagos).not.toContain(livre);
    }
  });

  it('escanear cupom e ver o veredito estão explicitamente na lista livre', () => {
    expect(NUNCA_COBRAVEL).toContain('escanear_cupom');
    expect(NUNCA_COBRAVEL).toContain('veredito');
    expect(NUNCA_COBRAVEL).toContain('faixa_tipica');
  });

  it('nenhuma contagem limita a contribuição — só profundidade e conveniência', () => {
    expect(Object.keys(LIMITES_GRATIS).sort()).toEqual(['alertas', 'mercadosNaCesta']);
  });
});

describe('plano', () => {
  it('quem não tem plano conhecido é grátis', () => {
    expect(PLANO_PADRAO).toBe('gratis');
    expect(ePlano('plus')).toBe(true);
    expect(ePlano('gratis')).toBe(true);
    expect(ePlano('premium')).toBe(false);
    expect(ePlano(undefined)).toBe(false);
  });

  it('recurso pago só no plus', () => {
    expect(podeUsar('gratis', 'estatisticas_detalhadas')).toBe(false);
    expect(podeUsar('plus', 'estatisticas_detalhadas')).toBe(true);
  });
});

describe('janelas de tempo', () => {
  it('o grátis vê os últimos meses; o plus não tem corte', () => {
    const corte = inicioDoHistorico('gratis', AGORA);
    expect(corte).not.toBeNull();
    // 31 de julho − 3 meses = 30 de abril (abril tem 30 dias). Sem o ajuste de
    // fim de mês, o `setMonth` devolveria 1º de maio e encurtaria a janela.
    expect(corte!.getMonth()).toBe(3);
    expect(corte!.getDate()).toBe(30);
    expect(inicioDoHistorico('plus', AGORA)).toBeNull();
    expect(HISTORICO_GRATIS_MESES).toBe(3);
  });

  it('corta o que é mais velho que a janela e mantém o recente', () => {
    expect(dentroDoHistorico('2026-07-20T00:00:00.000Z', 'gratis', AGORA)).toBe(true);
    expect(dentroDoHistorico('2026-01-10T00:00:00.000Z', 'gratis', AGORA)).toBe(false);
    // No plus, o mesmo cupom antigo aparece.
    expect(dentroDoHistorico('2026-01-10T00:00:00.000Z', 'plus', AGORA)).toBe(true);
  });

  it('data ausente ou inválida é MOSTRADA — defeito de dado não vira conteúdo pago', () => {
    expect(dentroDoHistorico(undefined, 'gratis', AGORA)).toBe(true);
    expect(dentroDoHistorico('nao-e-data', 'gratis', AGORA)).toBe(true);
  });

  it('o gráfico do produto tem janela própria, em dias', () => {
    expect(GRAFICO_GRATIS_DIAS).toBe(30);
    expect(inicioDoGrafico('plus', AGORA)).toBeNull();
    expect(dentroDoGrafico('2026-07-25T00:00:00.000Z', 'gratis', AGORA)).toBe(true);
    expect(dentroDoGrafico('2026-05-25T00:00:00.000Z', 'gratis', AGORA)).toBe(false);
  });
});

describe('contagens', () => {
  it('teto no grátis, sem teto no plus', () => {
    expect(limiteDe('gratis', 'alertas')).toBe(3);
    expect(limiteDe('plus', 'alertas')).toBe(Infinity);
  });

  it('podeAdicionar respeita o teto', () => {
    expect(podeAdicionar('gratis', 'alertas', 2)).toBe(true);
    expect(podeAdicionar('gratis', 'alertas', 3)).toBe(false);
    expect(podeAdicionar('plus', 'alertas', 999)).toBe(true);
  });

  it('aplicarTeto devolve o que aparece e quantos ficaram de fora', () => {
    const mercados = ['a', 'b', 'c', 'd', 'e'];
    expect(aplicarTeto('gratis', 'mercadosNaCesta', mercados)).toEqual({
      visiveis: ['a', 'b', 'c'],
      ocultos: 2,
    });
    expect(aplicarTeto('plus', 'mercadosNaCesta', mercados)).toEqual({
      visiveis: mercados,
      ocultos: 0,
    });
  });

  it('lista curta não inventa ocultos', () => {
    expect(aplicarTeto('gratis', 'mercadosNaCesta', ['a'])).toEqual({
      visiveis: ['a'],
      ocultos: 0,
    });
  });
});
