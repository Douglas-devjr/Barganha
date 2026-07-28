/**
 * C10.4 — Métricas de performance.
 *
 * O foco dos testes é onde um coletor de métricas costuma mentir: percentil
 * (média disfarçada), classificação de erro (4xx contado como falha faz o
 * alerta gritar por usuário digitando errado), cardinalidade (o coletor virando
 * o vazamento de memória que deveria denunciar) e CPU acumulada exibida como se
 * fosse instantânea.
 */

import { describe, expect, it, vi } from 'vitest';

import { MetricasMemoria } from './metricas';

describe('MetricasMemoria — latência de banco', () => {
  it('conta chamadas e separa erro de sucesso', () => {
    const m = new MetricasMemoria();

    m.observarBanco('obterDoUsuario', 10, true);
    m.observarBanco('obterDoUsuario', 20, true);
    m.observarBanco('obterDoUsuario', 30, false);

    const r = m.resumo().banco.obterDoUsuario!;
    expect(r.chamadas).toBe(3);
    expect(r.erros).toBe(1);
  });

  it('usa percentil, não média — a cauda não pode sumir', () => {
    const m = new MetricasMemoria();

    // 95 rápidas e 5 lentíssimas: a média (≈440ms) descreveria um sistema
    // saudável. O p95 é quem conta que houve gente esperando 8s.
    for (let i = 0; i < 95; i++) m.observarBanco('consulta', 40, true);
    for (let i = 0; i < 5; i++) m.observarBanco('consulta', 8_000, true);

    const r = m.resumo().banco.consulta!;
    expect(r.p50).toBe(40);
    expect(r.p95).toBe(8_000);
    expect(r.maxMs).toBe(8_000);
  });

  it('guarda o pico desde o boot mesmo quando ele sai da janela de amostra', () => {
    const m = new MetricasMemoria();

    m.observarBanco('x', 9_999, true);
    // A amostra circular tem 256 posições; 300 medições expulsam a primeira.
    for (let i = 0; i < 300; i++) m.observarBanco('x', 5, true);

    const r = m.resumo().banco.x!;
    expect(r.p50).toBe(5); // a janela recente já esqueceu o pico…
    expect(r.maxMs).toBe(9_999); // …mas o acumulado não deixa ele desaparecer.
    expect(r.chamadas).toBe(301);
  });

  it('limita a cardinalidade — o coletor não pode virar o vazamento', () => {
    const m = new MetricasMemoria();

    // O caso real: alguém instrumenta usando um id no nome da operação.
    for (let i = 0; i < 500; i++) m.observarBanco(`consulta-${i}`, 1, true);

    const chaves = Object.keys(m.resumo().banco);
    expect(chaves.length).toBeLessThanOrEqual(101); // 100 + `outros`
    expect(chaves).toContain('outros');
  });
});

describe('MetricasMemoria — HTTP', () => {
  it('conta 5xx como erro', () => {
    const m = new MetricasMemoria();

    m.observarHttp('GET /consulta/preco', 12, 500);

    expect(m.resumo().http['GET /consulta/preco']!.erros).toBe(1);
  });

  it('NÃO conta 4xx como erro — recusar requisição inválida é funcionar', () => {
    const m = new MetricasMemoria();

    m.observarHttp('POST /ingestao/qr', 5, 400);
    m.observarHttp('POST /ingestao/qr', 5, 401);
    m.observarHttp('POST /ingestao/qr', 5, 429);

    const r = m.resumo().http['POST /ingestao/qr']!;
    expect(r.chamadas).toBe(3);
    // Se 4xx contasse, um usuário digitando errado dispararia alerta de erro.
    expect(r.erros).toBe(0);
  });
});

describe('MetricasMemoria — cache', () => {
  it('calcula a taxa de acerto', () => {
    const m = new MetricasMemoria();

    for (let i = 0; i < 3; i++) m.observarCache('token-auth', 'hit');
    m.observarCache('token-auth', 'miss');

    expect(m.resumo().cache['token-auth']).toEqual({ hits: 3, misses: 1, taxaAcerto: 0.75 });
  });

  it('taxa 0 quando nunca houve acerto, sem divisão por zero', () => {
    const m = new MetricasMemoria();

    m.observarCache('vazio', 'miss');

    expect(m.resumo().cache.vazio!.taxaAcerto).toBe(0);
  });
});

describe('MetricasMemoria — processo', () => {
  it('reporta memória em MB', () => {
    const memoria = {
      rss: 100 * 1024 * 1024,
      heapUsed: 40 * 1024 * 1024,
      heapTotal: 60 * 1024 * 1024,
    } as NodeJS.MemoryUsage;
    const m = new MetricasMemoria(
      () => 0,
      () => 10,
      () => memoria,
      () => ({ user: 0, system: 0 }),
    );

    expect(m.resumo().processo.memoria).toEqual({
      rssMb: 100,
      heapUsadoMb: 40,
      heapTotalMb: 60,
    });
  });

  it('calcula CPU da JANELA, não o acumulado desde o boot', () => {
    // `process.cpuUsage()` só cresce; publicá-lo cru diria "já gastou 40s de
    // CPU" e nunca "está sob carga agora".
    let relogio = 0;
    const cpu = vi.fn((anterior?: NodeJS.CpuUsage) =>
      // Com argumento o Node devolve o DELTA; aqui: 500ms de CPU na janela.
      anterior ? { user: 500_000, system: 0 } : { user: 0, system: 0 },
    );
    const m = new MetricasMemoria(
      () => relogio,
      () => 1,
      () => ({ rss: 0, heapUsed: 0, heapTotal: 0 }) as NodeJS.MemoryUsage,
      cpu,
    );

    relogio = 1_000; // janela de 1s
    const r = m.resumo().processo.cpu;

    // 500ms de CPU numa janela de 1000ms = 50%.
    expect(r.percentual).toBe(50);
    expect(r.usuarioMs).toBe(500);
  });
});
