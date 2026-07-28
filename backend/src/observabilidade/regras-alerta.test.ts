/**
 * C10.4 — Regras de alerta.
 *
 * Um alerta erra de duas formas, e as duas o tornam inútil: se dispara à toa,
 * alguém o desliga na primeira semana; se não dispara, ninguém descobre a
 * anomalia. Por isso quase todo teste aqui vem em par — o caso que DEVE alertar
 * e o caso parecido que NÃO deve.
 */

import { describe, expect, it } from 'vitest';

import type { SnapshotMetricas } from './metricas';
import {
  avaliarAnomalias,
  formatarAnomalias,
  LIMIARES_ANOMALIA_PADRAO,
  lerLimiares,
} from './regras-alerta';
import type { RelatorioSaude } from './saude';

const saudavel: RelatorioSaude = {
  status: 'ok',
  geradoEm: '2026-07-28T00:00:00.000Z',
  versao: 'abc123',
  ambiente: 'production',
  uptimeS: 3_600,
  verificacoes: [{ nome: 'banco', critica: true, estado: 'ok', duracaoMs: 12 }],
};

const metricas = (parcial: Partial<SnapshotMetricas> = {}): SnapshotMetricas => ({
  geradoEm: '2026-07-28T00:00:00.000Z',
  processo: {
    uptimeS: 3_600,
    memoria: { rssMb: 120, heapUsadoMb: 60, heapTotalMb: 90 },
    cpu: { percentual: 8, usuarioMs: 80, sistemaMs: 20 },
  },
  banco: {},
  cache: {},
  http: {},
  ...parcial,
});

const latencia = (chamadas: number, p95: number, erros = 0) => ({
  chamadas,
  erros,
  p50: 20,
  p95,
  maxMs: p95,
});

describe('avaliarAnomalias — saúde', () => {
  it('nada a alertar quando tudo está ok', () => {
    expect(avaliarAnomalias(saudavel, metricas())).toEqual([]);
  });

  it('serviço FALHO vira anomalia crítica com o nome da sonda', () => {
    const r = avaliarAnomalias(
      {
        ...saudavel,
        status: 'falho',
        verificacoes: [
          {
            nome: 'banco',
            critica: true,
            estado: 'falho',
            duracaoMs: 5,
            detalhe: 'esquema (42P01)',
          },
        ],
      },
      metricas(),
    );

    expect(r[0]?.severidade).toBe('critico');
    expect(r[0]?.mensagem).toContain('banco=falho');
    expect(r[0]?.mensagem).toContain('42P01');
  });

  it('serviço DEGRADADO é aviso, não crítico', () => {
    const r = avaliarAnomalias(
      {
        ...saudavel,
        status: 'degradado',
        verificacoes: [{ nome: 'fila', critica: false, estado: 'degradado', duracaoMs: 1 }],
      },
      metricas(),
    );

    expect(r[0]?.severidade).toBe('aviso');
  });

  it('avalia saúde mesmo SEM métricas (token de curadoria ausente)', () => {
    const r = avaliarAnomalias({ ...saudavel, status: 'falho' }, undefined);

    // Meio alerta é melhor que nenhum.
    expect(r).toHaveLength(1);
  });
});

describe('avaliarAnomalias — latência', () => {
  it('alerta quando o p95 de uma rota passa do limiar', () => {
    const r = avaliarAnomalias(
      saudavel,
      metricas({ http: { 'GET /consulta/preco': latencia(100, 5_000) } }),
    );

    expect(r[0]?.regra).toBe('latencia-http');
    expect(r[0]?.mensagem).toContain('5000ms');
  });

  it('NÃO alerta com amostra pequena — p95 de 3 chamadas não é p95', () => {
    // O caso real: a primeira chamada depois do cold start do free tier leva
    // 30–60s. Sem o piso de amostra isso viraria alerta todo dia.
    const r = avaliarAnomalias(saudavel, metricas({ http: { 'GET /saude': latencia(3, 45_000) } }));

    expect(r).toEqual([]);
  });

  it('alerta p95 de operação de banco', () => {
    const r = avaliarAnomalias(
      saudavel,
      metricas({ banco: { obterDoUsuario: latencia(200, 3_000) } }),
    );

    expect(r[0]?.regra).toBe('latencia-banco');
    expect(r[0]?.mensagem).toContain('obterDoUsuario');
  });
});

describe('avaliarAnomalias — erro HTTP', () => {
  it('taxa de 5xx acima do limiar é CRÍTICA', () => {
    const r = avaliarAnomalias(
      saudavel,
      metricas({ http: { 'POST /ingestao/qr': latencia(100, 50, 20) } }),
    );

    const erro = r.find((a) => a.regra === 'erro-http');
    expect(erro?.severidade).toBe('critico');
    expect(erro?.mensagem).toContain('20%');
  });

  it('não alerta com 5xx abaixo do limiar', () => {
    const r = avaliarAnomalias(
      saudavel,
      metricas({ http: { 'POST /ingestao/qr': latencia(100, 50, 2) } }),
    );

    expect(r.find((a) => a.regra === 'erro-http')).toBeUndefined();
  });
});

describe('avaliarAnomalias — cache', () => {
  it('alerta quando o cache para de acertar', () => {
    const r = avaliarAnomalias(
      saudavel,
      metricas({ cache: { 'token-auth': { hits: 10, misses: 90, taxaAcerto: 0.1 } } }),
    );

    expect(r[0]?.regra).toBe('cache-frio');
    expect(r[0]?.mensagem).toContain('10%');
  });

  it('não alerta com cache saudável', () => {
    const r = avaliarAnomalias(
      saudavel,
      metricas({ cache: { 'token-auth': { hits: 90, misses: 10, taxaAcerto: 0.9 } } }),
    );

    expect(r).toEqual([]);
  });

  it('não alerta com poucas consultas ao cache', () => {
    const r = avaliarAnomalias(
      saudavel,
      metricas({ cache: { novo: { hits: 0, misses: 2, taxaAcerto: 0 } } }),
    );

    expect(r).toEqual([]);
  });
});

describe('avaliarAnomalias — processo', () => {
  it('memória acima do limiar é CRÍTICA (o Render mata em 512MB)', () => {
    const base = metricas();
    const r = avaliarAnomalias(saudavel, {
      ...base,
      processo: { ...base.processo, memoria: { rssMb: 450, heapUsadoMb: 400, heapTotalMb: 440 } },
    });

    expect(r[0]?.regra).toBe('memoria');
    expect(r[0]?.severidade).toBe('critico');
  });

  it('CPU alta é aviso', () => {
    const base = metricas();
    const r = avaliarAnomalias(saudavel, {
      ...base,
      processo: { ...base.processo, cpu: { percentual: 95, usuarioMs: 950, sistemaMs: 0 } },
    });

    expect(r[0]?.regra).toBe('cpu');
    expect(r[0]?.severidade).toBe('aviso');
  });
});

describe('avaliarAnomalias — ordenação', () => {
  it('coloca as críticas primeiro', () => {
    const base = metricas();
    const r = avaliarAnomalias(saudavel, {
      ...base,
      http: {
        'GET /lenta': latencia(100, 9_000),
        'POST /quebrada': latencia(100, 30, 50),
      },
    });

    // Quem lê o alerta age pela primeira linha.
    expect(r[0]?.severidade).toBe('critico');
  });
});

describe('lerLimiares', () => {
  it('usa os padrões quando o ambiente está vazio', () => {
    expect(lerLimiares({})).toEqual(LIMIARES_ANOMALIA_PADRAO);
  });

  it('respeita o limiar configurado — calibrar não pode exigir deploy', () => {
    const l = lerLimiares({ ALERTA_LATENCIA_HTTP_P95_MS: '500' });

    expect(l.latenciaHttpP95Ms).toBe(500);
  });

  it('cai no padrão quando o valor é inválido', () => {
    // Alerta nunca deve sumir por causa de um número mal digitado.
    const l = lerLimiares({ ALERTA_MEMORIA_RSS_MB: 'muito' });

    expect(l.memoriaRssMb).toBe(LIMIARES_ANOMALIA_PADRAO.memoriaRssMb);
  });

  it('aceita zero como valor explícito', () => {
    expect(lerLimiares({ ALERTA_TAXA_ERRO_HTTP: '0' }).taxaErroHttp).toBe(0);
  });
});

describe('formatarAnomalias', () => {
  it('marca como crítico quando há ao menos uma crítica', () => {
    const texto = formatarAnomalias([
      { regra: 'cpu', severidade: 'aviso', mensagem: 'CPU em 90%' },
      { regra: 'memoria', severidade: 'critico', mensagem: 'memória 450MB' },
    ]);

    expect(texto).toContain('crítica');
    expect(texto).toContain('[memoria]');
  });

  it('usa o tom de degradação quando só há avisos', () => {
    const texto = formatarAnomalias([
      { regra: 'cpu', severidade: 'aviso', mensagem: 'CPU em 90%' },
    ]);

    expect(texto).toContain('degradação');
    expect(texto).not.toContain('crítica');
  });
});
