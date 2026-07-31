/** C8.4 — Regras puras do alerta: escolha do nível regional e disparo. */

import { describe, expect, it } from 'vitest';

import type { CacheEstatistica } from '../dados/tipos';
import { avaliarAlerta, escolherEstatisticaRegional } from './alertas-regras';

/**
 * "Agora" fixo do teste. As datas das fixtures são RELATIVAS a ele e o `avaliarAlerta`
 * recebe a mesma referência — sem isso o teste passaria hoje e quebraria sozinho
 * quando o relógio real ultrapassasse a janela de frescor.
 */
const AGORA = new Date('2026-07-29T12:00:00.000Z');
const DIA_MS = 86_400_000;
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * DIA_MS).toISOString();

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
  observadoEmMaisRecente: diasAtras(3),
  atualizadoEm: diasAtras(1),
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
    const r = avaliarAlerta(ALERTA, est({ mediana: 8.5 }), AGORA);
    expect(r).toMatchObject({ motivo: 'tipico', mediana: 8.5 });
  });

  it('dispara pelo menor visto (mínimo/promoção) mesmo com típico acima', () => {
    const r = avaliarAlerta(
      ALERTA,
      est({ mediana: 11, minimo: 9.5, menorPromocional: 8.9 }),
      AGORA,
    );
    expect(r).toMatchObject({ motivo: 'menor_visto', menorVisto: 8.9 });
  });

  it('não dispara acima do alvo nem sem estatística', () => {
    expect(avaliarAlerta(ALERTA, est({ mediana: 10.5 }), AGORA)).toBeNull();
    expect(avaliarAlerta(ALERTA, null, AGORA)).toBeNull();
  });

  it('NÃO dispara com preço velho, mesmo batendo o alvo', () => {
    // O alerta manda a pessoa ao mercado. Um típico de 90 dias atrás que "bateu o
    // alvo" pode ser um preço que não existe mais.
    const velho = est({ mediana: 8.5, observadoEmMaisRecente: diasAtras(90) });
    expect(avaliarAlerta(ALERTA, velho, AGORA)).toBeNull();
  });

  it('NÃO dispara sem data conhecida — espera a próxima sincronização', () => {
    // Linha em cache antes da v10: idade desconhecida não é frescor. Atrasar o
    // alerta custa um dia; disparar errado custa a confiança no app.
    const semData = est({ mediana: 8.5, observadoEmMaisRecente: null });
    expect(avaliarAlerta(ALERTA, semData, AGORA)).toBeNull();
  });

  it('o recálculo do servidor não rejuvenesce o alerta', () => {
    // `atualizadoEm` de hoje (varredura geral no deploy) com preço de 60 dias:
    // se o gate olhasse o campo errado, todo alerta velho voltaria a disparar de
    // uma vez só, em massa, no primeiro deploy.
    const recalculadoHoje = est({
      mediana: 8.5,
      observadoEmMaisRecente: diasAtras(60),
      atualizadoEm: AGORA.toISOString(),
    });
    expect(avaliarAlerta(ALERTA, recalculadoHoje, AGORA)).toBeNull();
  });
});
