/**
 * Testes da redação de log. Este arquivo é um CONTROLE DE PRIVACIDADE, não um
 * teste de formatação: cada caso aqui corresponde a um caminho real pelo qual
 * dado pessoal chegaria ao log (ou ao banco, via `marcarFalha`).
 */

import { describe, expect, it } from 'vitest';

import { redigirTexto, sanitizarErro } from './redacao';

describe('redigirTexto', () => {
  it('redige CPF formatado', () => {
    const saida = redigirTexto('CONSUMIDOR CPF: 123.456.789-00');
    expect(saida).not.toContain('123.456.789-00');
    expect(saida).toContain('[REDIGIDO]');
  });

  it('redige CPF sem formatação (11 dígitos soltos)', () => {
    const saida = redigirTexto('cpf 12345678900 do consumidor');
    expect(saida).not.toContain('12345678900');
  });

  it('redige a chave de acesso de 44 dígitos', () => {
    const chave = '33260612345678000199650010000000011000000016';
    const saida = redigirTexto(`chave ${chave} invalida`);
    expect(saida).not.toContain(chave);
    expect(saida).toContain('[REDIGIDO](chave)');
  });

  it('redige JWT mesmo sem o prefixo Bearer', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc-_123';
    const saida = redigirTexto(`falha com token ${jwt}`);
    expect(saida).not.toContain(jwt);
  });

  it('redige o header Authorization inteiro', () => {
    const saida = redigirTexto('Authorization: Bearer sk-live-abcdef123456');
    expect(saida).not.toContain('sk-live-abcdef123456');
  });

  it('redige e-mail', () => {
    const saida = redigirTexto('usuario alguem@exemplo.com.br nao encontrado');
    expect(saida).not.toContain('alguem@exemplo.com.br');
  });

  it('MANTÉM o CNPJ da loja — é dado de empresa e serve ao diagnóstico', () => {
    // Decisão travada nº4: a geo é pela LOJA. Redigir o CNPJ cegaria a
    // investigação de "nota não corresponde à chave" sem ganho de privacidade.
    const saida = redigirTexto('CNPJ do emitente (12345678000199) não corresponde');
    expect(saida).toContain('12345678000199');
  });

  it('trunca texto longo — log não é depósito de HTML de portal', () => {
    const saida = redigirTexto('x'.repeat(5000));
    expect(saida.length).toBeLessThan(400);
    expect(saida).toContain('[truncado]');
  });

  it('é seguro aplicar duas vezes', () => {
    const uma = redigirTexto('CPF: 123.456.789-00');
    expect(redigirTexto(uma)).toBe(uma);
  });
});

describe('sanitizarErro', () => {
  it('preserva o tipo do erro (é o que se agrupa e alerta)', () => {
    class FalhaParserSefazError extends Error {
      constructor(m: string) {
        super(m);
        this.name = 'FalhaParserSefazError';
      }
    }
    const r = sanitizarErro(new FalhaParserSefazError('Valor ilegível'));
    expect(r.tipo).toBe('FalhaParserSefazError');
  });

  it('redige a mensagem do erro', () => {
    const r = sanitizarErro(new Error('achei CPF 123.456.789-00 no HTML'));
    expect(r.mensagem).not.toContain('123.456.789-00');
  });

  it('não vaza a pilha (lugar clássico de argumento sensível)', () => {
    const r = sanitizarErro(new Error('falhou'));
    expect(Object.keys(r).sort()).toEqual(['mensagem', 'tipo']);
  });

  it('lida com o que não é Error', () => {
    expect(sanitizarErro('texto solto').tipo).toBe('DesconhecidoError');
    expect(sanitizarErro(undefined).mensagem).toBe('undefined');
  });
});
