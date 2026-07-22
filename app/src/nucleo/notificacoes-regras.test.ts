/**
 * Feed de notificações — o que importa testar aqui é a DEDUPLICAÇÃO: o motor de
 * alertas roda a cada foco do Início e a contribuição é recalculada do zero,
 * então a chave é o que impede o feed de inundar com o mesmo aviso.
 */

import { describe, expect, it } from 'vitest';

import type { AlertaDisparado } from './alertas-regras';
import type { Selo } from './gamificacao';
import { deAlerta, deResumoMensal, deSelos, diaLocal, mesLocal } from './notificacoes-regras';

// Sexta 10/07/2026 12:00 local.
const AGORA = new Date(2026, 6, 10, 12, 0, 0);

const disparo: AlertaDisparado = {
  produtoCanonicoId: 'leite-italac-1l',
  nome: 'Leite integral Italac 1 L',
  precoAlvo: 4.7,
  mediana: 5.49,
  menorVisto: 4.59,
  motivo: 'menor_visto',
};

describe('deAlerta', () => {
  it('gera a MESMA chave para o mesmo disparo no mesmo dia', () => {
    const manha = deAlerta(disparo, new Date(2026, 6, 10, 8, 0, 0));
    const noite = deAlerta(disparo, new Date(2026, 6, 10, 22, 0, 0));
    expect(manha.chaveDedupe).toBe(noite.chaveDedupe);
  });

  it('gera chave nova no dia seguinte (se cair de novo, avisa de novo)', () => {
    const hoje = deAlerta(disparo, AGORA);
    const amanha = deAlerta(disparo, new Date(2026, 6, 11, 9, 0, 0));
    expect(hoje.chaveDedupe).not.toBe(amanha.chaveDedupe);
  });

  it('separa os motivos: típico e menor visto são avisos distintos', () => {
    const porMenor = deAlerta(disparo, AGORA);
    const porTipico = deAlerta({ ...disparo, motivo: 'tipico' }, AGORA);
    expect(porMenor.chaveDedupe).not.toBe(porTipico.chaveDedupe);
  });

  it('leva o produto para a navegação e descreve como chegou ao alvo', () => {
    const n = deAlerta(disparo, AGORA);
    expect(n.tipo).toBe('preco_baixou');
    expect(n.produtoCanonicoId).toBe('leite-italac-1l');
    expect(n.subtitulo).toContain('Menor visto');
    expect(n.subtitulo).toContain('4,59');
    expect(n.subtitulo).toContain('4,70'); // o alvo
  });
});

describe('deSelos', () => {
  const selos: Selo[] = [
    {
      id: 'primeira-nota',
      titulo: 'Primeira nota',
      descricao: 'Escaneou o primeiro',
      conquistado: true,
    },
    { id: 'cacador', titulo: 'Caçador de preços', descricao: '10 cupons', conquistado: false },
  ];

  it('só vira evento o selo já conquistado', () => {
    const eventos = deSelos(selos, AGORA);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.titulo).toContain('Primeira nota');
  });

  it('a chave é estável no tempo — recalcular não duplica a conquista', () => {
    const hoje = deSelos(selos, AGORA);
    const semanaQueVem = deSelos(selos, new Date(2026, 6, 17, 9, 0, 0));
    expect(hoje[0]?.chaveDedupe).toBe(semanaQueVem[0]?.chaveDedupe);
  });
});

describe('deResumoMensal', () => {
  it('uma chave por mês', () => {
    const junho = deResumoMensal('2026-06', 132.4, AGORA);
    const julho = deResumoMensal('2026-07', 98.1, AGORA);
    expect(junho?.chaveDedupe).toBe('resumo:2026-06');
    expect(julho?.chaveDedupe).toBe('resumo:2026-07');
  });

  it('não polui o feed quando não houve economia', () => {
    expect(deResumoMensal('2026-06', 0, AGORA)).toBeNull();
    expect(deResumoMensal('2026-06', -5, AGORA)).toBeNull();
  });

  it('escreve o mês por extenso em pt-BR', () => {
    expect(deResumoMensal('2026-06', 132.4, AGORA)?.titulo).toContain('junho de 2026');
  });
});

describe('buckets de tempo', () => {
  it('usam o fuso LOCAL, não UTC (senão o dia vira na hora errada)', () => {
    // 23h local de 10/07 — em UTC-3 isso já é 11/07 em UTC.
    expect(diaLocal(new Date(2026, 6, 10, 23, 30, 0))).toBe('2026-07-10');
    expect(mesLocal(new Date(2026, 6, 31, 23, 30, 0))).toBe('2026-07');
  });
});
