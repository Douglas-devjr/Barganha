import { describe, expect, it } from 'vitest';

import { extrairObservacoesAnonimas, type NotaProcessada } from './gate';

const CHAVES_PROIBIDAS = ['usuarioId', 'cupomId', 'chaveAcesso', 'cpf', 'nome'];

function notaExemplo(): NotaProcessada {
  return {
    loja: { cnpj: '12345678000199', municipio: 'Rio de Janeiro', uf: 'RJ' },
    observadoEm: '2026-06-20T18:30:00.000Z',
    usuarioId: 'user-1',
    cupomId: 'cupom-1',
    chaveAcesso: '33260612345678000199650010000000011000000017',
    itens: [
      { produtoCanonicoId: 'p-cafe', precoNormalizado: 33.8, unidadeBase: 'kg', emPromocao: false },
      { produtoCanonicoId: 'p-leite', precoNormalizado: 4.79, unidadeBase: 'L', emPromocao: true },
    ],
  };
}

describe('gate de anonimização (C1.4)', () => {
  it('gera uma observação solta por item', () => {
    const obs = extrairObservacoesAnonimas(notaExemplo());
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({
      produtoCanonicoId: 'p-cafe',
      lojaCnpj: '12345678000199',
      municipio: 'Rio de Janeiro',
      uf: 'RJ',
      precoNormalizado: 33.8,
      unidadeBase: 'kg',
      emPromocao: false,
      observadoEm: '2026-06-20T18:30:00.000Z',
    });
  });

  it('NUNCA propaga dado pessoal — nem chave, usuário ou cesta', () => {
    const obs = extrairObservacoesAnonimas(notaExemplo());
    for (const o of obs) {
      for (const proibida of CHAVES_PROIBIDAS) {
        expect(o).not.toHaveProperty(proibida);
      }
      // sem vínculo de cesta: nada que religue os itens entre si.
      expect(o).not.toHaveProperty('cupomId');
    }
  });

  it('ignora PII extra injetada na entrada (defesa por construção)', () => {
    const poluida = {
      ...notaExemplo(),
      cpf: '11122233344',
      nome: 'Fulano de Tal',
    } as NotaProcessada;

    const obs = extrairObservacoesAnonimas(poluida);
    const serializado = JSON.stringify(obs);
    expect(serializado).not.toContain('11122233344');
    expect(serializado).not.toContain('Fulano');
    expect(serializado).not.toContain('33260612345678000199650010000000011000000017');
  });
});
