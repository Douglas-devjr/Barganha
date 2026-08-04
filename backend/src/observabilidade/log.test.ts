/**
 * C10.2 — Testes da CONFIGURAÇÃO do logger, não do ato de logar.
 *
 * Por que isto existe: a lista `paths` do `redact` do Pino falha em SILÊNCIO.
 * Um caminho escrito errado não dá erro nem aviso — o campo simplesmente sai em
 * claro no stdout. Sem teste, a máscara pode estar quebrada há meses e o único
 * jeito de descobrir é achar um token num log de produção.
 *
 * Aqui montamos um Pino com a MESMA configuração exportada por `log.ts`, mas
 * escrevendo num buffer, e conferimos o que de fato saiu.
 */

import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { CAMPOS_REDIGIDOS } from './log';

/** Loga um objeto com a config real e devolve a linha JSON que sairia. */
function linhaDeLog(objeto: Record<string, unknown>): string {
  const linhas: string[] = [];
  const logger = pino(
    {
      level: 'info',
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: CAMPOS_REDIGIDOS, censor: '[REDIGIDO]' },
      base: { servico: 'barganha-backend' },
    },
    { write: (l: string) => linhas.push(l) },
  );
  logger.info(objeto, 'teste');
  return linhas.join('\n');
}

describe('máscara do logger (redact do Pino)', () => {
  it('redige o header Authorization da requisição', () => {
    const saida = linhaDeLog({ req: { headers: { authorization: 'Bearer token-secreto' } } });
    expect(saida).not.toContain('token-secreto');
    expect(saida).toContain('[REDIGIDO]');
  });

  it('redige token, senha e cpf aninhados', () => {
    const saida = linhaDeLog({ dados: { token: 'abc', senha: 'hunter2', cpf: '11122233344' } });
    expect(saida).not.toContain('abc');
    expect(saida).not.toContain('hunter2');
    expect(saida).not.toContain('11122233344');
  });

  it('redige a chave de acesso e o payload do QR (mundo privado, docs/04)', () => {
    const saida = linhaDeLog({
      cupom: {
        chaveAcesso: '33260612345678000199650010000000011000000016',
        qrPayload: 'http://x?p=y',
      },
    });
    expect(saida).not.toContain('33260612345678000199650010000000011000000016');
    expect(saida).not.toContain('http://x?p=y');
  });

  it('redige o HTML da nota (pode conter CPF do consumidor)', () => {
    const saida = linhaDeLog({ ctx: { html: '<html>CPF 123.456.789-00</html>' } });
    expect(saida).not.toContain('123.456.789-00');
  });

  it('redige email/destinatario/corpoTexto/apiKey (rede de segurança do canal de e-mail, docs/04)', () => {
    const saida = linhaDeLog({
      conta: {
        email: 'pessoa@example.com',
        destinatario: 'outra-pessoa@example.com',
        corpoTexto: 'Conteúdo sensível do aviso',
        apiKey: 'chave-secreta-resend',
        emailApiKey: 'outra-chave-secreta',
      },
    });
    expect(saida).not.toContain('pessoa@example.com');
    expect(saida).not.toContain('outra-pessoa@example.com');
    expect(saida).not.toContain('Conteúdo sensível do aviso');
    expect(saida).not.toContain('chave-secreta-resend');
    expect(saida).not.toContain('outra-chave-secreta');
  });

  it('emite o nível como TEXTO — nenhum coletor deveria precisar de tabela', () => {
    expect(linhaDeLog({ action: 'x' })).toContain('"level":"info"');
  });

  it('carimba o serviço em toda linha', () => {
    expect(linhaDeLog({ action: 'x' })).toContain('"servico":"barganha-backend"');
  });

  it('NÃO redige o que é diagnóstico legítimo (cupomId, uf, action)', () => {
    const saida = linhaDeLog({ action: 'parsing.falha', cupomId: 'abc-123', uf: 'RJ' });
    expect(saida).toContain('abc-123');
    expect(saida).toContain('RJ');
    expect(saida).toContain('parsing.falha');
  });
});
