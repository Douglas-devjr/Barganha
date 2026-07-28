/**
 * Testes da redação de log. Este arquivo é um CONTROLE DE PRIVACIDADE, não um
 * teste de formatação: cada caso aqui corresponde a um caminho real pelo qual
 * dado pessoal chegaria ao log (ou ao banco, via `marcarFalha`).
 */

import { describe, expect, it } from 'vitest';

import { redigirTexto, sanitizarErro, sanitizarErroInesperado } from './redacao';

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

/**
 * C10.4 — `sanitizarErroInesperado` existe para um trade-off explícito: a pilha
 * é a única pista de um erro que ninguém previu, mas é também texto livre indo
 * para o log. Estes testes travam os dois lados — que os frames CHEGAM e que o
 * que não deve vazar não vaza.
 */
describe('sanitizarErroInesperado', () => {
  it('preserva tipo e mensagem, como o sanitizarErro', () => {
    const r = sanitizarErroInesperado(new TypeError('algo quebrou'));

    expect(r.tipo).toBe('TypeError');
    expect(r.mensagem).toBe('algo quebrou');
  });

  it('traz os frames da pilha — o motivo de o bloco existir', () => {
    const r = sanitizarErroInesperado(new Error('boom'));

    expect(r.pilha.length).toBeGreaterThan(0);
    expect(r.pilha[0]).toMatch(/^at /);
  });

  it('DESCARTA a primeira linha (tipo + mensagem), que já vai nos campos', () => {
    // Ela é também o pedaço do `stack` que carrega o texto da mensagem — e é aí
    // que HTML de portal ou dado pessoal apareceria dentro da pilha.
    const erro = new Error('33260612345678000199650010000000011000000016');

    const r = sanitizarErroInesperado(erro);

    expect(r.pilha.every((f) => !f.includes('650010000000011'))).toBe(true);
  });

  it('filtra frames de node_modules e do Node — ruído empurra a pista para fora', () => {
    const erro = new Error('x');
    erro.stack = [
      'Error: x',
      '    at nossoCodigo (/app/backend/src/http/servidor.ts:10:5)',
      '    at algo (/app/node_modules/fastify/lib/handle.js:1:1)',
      '    at process (node:internal/process/task_queues:95:5)',
    ].join('\n');

    const r = sanitizarErroInesperado(erro);

    expect(r.pilha).toHaveLength(1);
    expect(r.pilha[0]).toContain('servidor.ts');
  });

  it('sem frame NOSSO, guarda os primeiros — vazio seria pior que ruído', () => {
    const erro = new Error('x');
    erro.stack = [
      'Error: x',
      '    at a (/app/node_modules/pg/lib/client.js:1:1)',
      '    at b (/app/node_modules/pg/lib/pool.js:2:2)',
    ].join('\n');

    expect(sanitizarErroInesperado(erro).pilha.length).toBeGreaterThan(0);
  });

  it('redige dado sensível que apareça DENTRO de um frame', () => {
    const erro = new Error('x');
    erro.stack = ['Error: x', '    at f (/home/12345678901/app/src/a.ts:1:1)'].join('\n');

    expect(sanitizarErroInesperado(erro).pilha[0]).toContain('[REDIGIDO]');
  });

  it('limita a 12 frames — pilha não pode virar parede de log', () => {
    const erro = new Error('x');
    const frames = Array.from({ length: 40 }, (_, i) => `    at f${i} (/app/src/a.ts:${i}:1)`);
    erro.stack = ['Error: x', ...frames].join('\n');

    expect(sanitizarErroInesperado(erro).pilha).toHaveLength(12);
  });

  it('segue a cadeia de cause — é lá que mora a causa real', () => {
    const raiz = new Error('conexão recusada');
    const erro = new Error('falha ao salvar cupom', { cause: raiz });

    const r = sanitizarErroInesperado(erro);

    expect(r.causa?.mensagem).toBe('conexão recusada');
  });

  it('para de seguir cause em 3 níveis — evita ciclo e log gigante', () => {
    let erro = new Error('n0');
    for (let i = 1; i <= 6; i++) erro = new Error(`n${i}`, { cause: erro });

    let atual = sanitizarErroInesperado(erro).causa;
    let profundidade = 0;
    while (atual) {
      profundidade++;
      atual = atual.causa;
    }

    expect(profundidade).toBe(3);
  });

  it('aceita o que não é Error, sem pilha inventada', () => {
    const r = sanitizarErroInesperado('string solta');

    expect(r.tipo).toBe('DesconhecidoError');
    expect(r.pilha).toEqual([]);
  });
});
