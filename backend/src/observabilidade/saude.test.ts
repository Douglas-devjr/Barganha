/**
 * C10.4 — O health check é o gatilho do rollback automático, então o que se
 * testa aqui não é "ele responde": é a REGRA DE CLASSIFICAÇÃO. Um `degradado`
 * classificado como `falho` reverte deploys inocentes; um `falho` classificado
 * como `degradado` deixa subir a versão quebrada. Os dois erros são caros e
 * nenhum deles aparece em ambiente de desenvolvimento.
 */

import { describe, expect, it, vi } from 'vitest';

import { MonitorSaude, type Sonda } from './saude';
import { sondaBanco, sondaFila, sondaParsers, sondaTelemetria } from './sondas';

const sonda = (nome: string, critica: boolean, estado: 'ok' | 'degradado' | 'falho'): Sonda => ({
  nome,
  critica,
  verificar: () => Promise.resolve({ estado }),
});

const opcoes = { versao: 'abc123', ambiente: 'teste', cacheMs: 0 };

describe('MonitorSaude', () => {
  it('reporta ok quando todas as sondas passam', async () => {
    const monitor = new MonitorSaude([sonda('a', true, 'ok'), sonda('b', false, 'ok')], opcoes);

    const r = await monitor.relatorio();

    expect(r.status).toBe('ok');
    expect(r.versao).toBe('abc123');
    expect(r.verificacoes).toHaveLength(2);
  });

  it('deixa o pior estado vencer', async () => {
    const monitor = new MonitorSaude(
      [sonda('a', true, 'ok'), sonda('b', true, 'degradado')],
      opcoes,
    );

    expect((await monitor.relatorio()).status).toBe('degradado');
  });

  it('sonda CRÍTICA falha → serviço falho (é isto que reprova o deploy)', async () => {
    const monitor = new MonitorSaude([sonda('banco', true, 'falho')], opcoes);

    expect((await monitor.relatorio()).status).toBe('falho');
  });

  it('sonda NÃO crítica falha → degradado, nunca falho', async () => {
    // A regra que evita o rollback burro: a telemetria parar de gravar é ruim,
    // mas voltar à versão anterior não conserta e ainda tira o serviço do ar.
    const monitor = new MonitorSaude([sonda('telemetria', false, 'falho')], opcoes);

    expect((await monitor.relatorio()).status).toBe('degradado');
  });

  it('sonda travada vira degradado em vez de pendurar a rota', async () => {
    const travada: Sonda = {
      nome: 'lenta',
      critica: true,
      verificar: () => new Promise(() => {}), // nunca resolve
    };
    const monitor = new MonitorSaude([travada], { ...opcoes, timeoutSondaMs: 10 });

    const r = await monitor.relatorio();

    // Crítica, mas o TIMEOUT não é prova de que a versão está ruim — o
    // termômetro quebrado não pode disparar rollback.
    expect(r.status).toBe('degradado');
    expect(r.verificacoes[0]?.detalhe).toContain('não respondeu');
  });

  it('sonda que lança é capturada, não derruba o relatório', async () => {
    const explode: Sonda = {
      nome: 'ruim',
      critica: false,
      verificar: () => Promise.reject(new Error('boom')),
    };
    const monitor = new MonitorSaude([explode, sonda('ok', true, 'ok')], opcoes);

    expect((await monitor.relatorio()).status).toBe('degradado');
  });

  it('cacheia o relatório e compartilha a coleta entre chamadas simultâneas', async () => {
    const verificar = vi.fn().mockResolvedValue({ estado: 'ok' });
    const monitor = new MonitorSaude([{ nome: 'a', critica: true, verificar }], {
      ...opcoes,
      cacheMs: 60_000,
      agora: () => 1_000,
    });

    await Promise.all([monitor.relatorio(), monitor.relatorio()]);
    await monitor.relatorio();

    // Três pedidos, UMA execução da sonda: é o que impede o cron de 10 min + a
    // sonda do Render virarem consulta ao banco a cada batida.
    expect(verificar).toHaveBeenCalledTimes(1);
  });
});

describe('sondaBanco', () => {
  it('consulta sem erro → ok', async () => {
    const s = sondaBanco(() => Promise.resolve({ error: null }));

    expect(await s.verificar()).toEqual({ estado: 'ok' });
  });

  it('erro de ESQUEMA → falho (a migração não rodou; rollback resolve)', async () => {
    const s = sondaBanco(() =>
      Promise.resolve({ error: { message: 'relation does not exist', code: '42P01' } }),
    );

    const r = await s.verificar();

    expect(r.estado).toBe('falho');
    expect(r.detalhe).toContain('42P01');
  });

  it('erro de REDE → degradado (reverter não levantaria o Supabase)', async () => {
    const s = sondaBanco(() =>
      Promise.resolve({ error: { message: 'fetch failed', code: 'ECONNRESET' } }),
    );

    expect((await s.verificar()).estado).toBe('degradado');
  });

  it('erro sem código → degradado (o desconhecido não reprova deploy)', async () => {
    const s = sondaBanco(() => Promise.resolve({ error: { message: 'algo estranho' } }));

    expect((await s.verificar()).estado).toBe('degradado');
  });

  it('consulta que lança é tratada como degradação', async () => {
    const s = sondaBanco(() => Promise.reject(new Error('socket hang up')));

    expect((await s.verificar()).estado).toBe('degradado');
  });

  it('é crítica — é ela que pode reprovar o deploy', () => {
    expect(sondaBanco(() => Promise.resolve({ error: null })).critica).toBe(true);
  });
});

describe('sondaParsers', () => {
  const rollout = (ufs: string[]) => ({ habilitada: () => true, ufs: () => ufs });

  it('toda UF habilitada tem parser → ok', async () => {
    const s = sondaParsers(rollout(['RJ', 'SP']), (uf) => ['RJ', 'SP'].includes(uf));

    expect((await s.verificar()).estado).toBe('ok');
  });

  it('UF habilitada SEM parser → falho, com a UF no detalhe', async () => {
    // O modo de falha silencioso que isto pega: sem a sonda, todo cupom do MG
    // cairia em `sem_parser` e só ficaria represado — nada no log gritaria.
    const s = sondaParsers(rollout(['RJ', 'MG']), (uf) => uf === 'RJ');

    const r = await s.verificar();

    expect(r.estado).toBe('falho');
    expect(r.detalhe).toContain('MG');
  });
});

describe('sondaTelemetria', () => {
  const fonte = (falhas: number) => ({
    snapshot: () => ({
      geradoEm: '2026-07-28T00:00:00.000Z',
      totais: {},
      porUf: {},
      saude: { falhasPersistencia: falhas, ultimaFalhaMotivo: 'timeout' },
    }),
  });

  it('sem falhas de persistência → ok', async () => {
    expect((await sondaTelemetria(fonte(0)).verificar()).estado).toBe('ok');
  });

  it('com falhas → degradado e diz quantas', async () => {
    const r = await sondaTelemetria(fonte(3)).verificar();

    expect(r.estado).toBe('degradado');
    expect(r.detalhe).toContain('3');
  });

  it('não é crítica — histórico perdido não é motivo de rollback', () => {
    expect(sondaTelemetria(fonte(0)).critica).toBe(false);
  });
});

describe('sondaFila', () => {
  it('abaixo do limiar → ok', async () => {
    const s = sondaFila(() => ({ pendentes: 5, emCurso: 2 }), 50);

    expect((await s.verificar()).estado).toBe('ok');
  });

  it('represada acima do limiar → degradado', async () => {
    const s = sondaFila(() => ({ pendentes: 120, emCurso: 4 }), 50);

    const r = await s.verificar();

    expect(r.estado).toBe('degradado');
    expect(r.detalhe).toContain('120');
  });
});
