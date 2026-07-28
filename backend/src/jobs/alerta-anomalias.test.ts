/**
 * C10.4 — O job de anomalias só tem uma responsabilidade própria (as regras são
 * testadas em `regras-alerta.test.ts`): colher os dois snapshots pela rede sem
 * ficar cego quando algo dá errado. Os testes cobrem exatamente os modos de
 * cegueira — API fora, token ausente, `/metricas` recusado, 503 legítimo.
 */

import { describe, expect, it, vi } from 'vitest';

import { avaliarApi } from './alerta-anomalias';

const relatorio = (status: 'ok' | 'degradado' | 'falho') => ({
  status,
  geradoEm: '2026-07-28T00:00:00.000Z',
  versao: 'abc123',
  ambiente: 'production',
  uptimeS: 100,
  verificacoes: [{ nome: 'banco', critica: true, estado: status, duracaoMs: 3 }],
});

const resposta = (corpo: unknown, status = 200) =>
  ({ ok: status < 400, status, json: () => Promise.resolve(corpo) }) as Response;

describe('avaliarApi', () => {
  it('não acusa nada quando a API está saudável', async () => {
    const fetchFn = vi.fn().mockResolvedValue(resposta(relatorio('ok')));

    expect(await avaliarApi({ apiUrl: 'https://api.teste', fetchFn })).toEqual([]);
  });

  it('API que não responde vira anomalia CRÍTICA', async () => {
    // Sem esta regra o job ficaria verde justamente no pior cenário: as regras
    // precisam de um relatório para avaliar, e não havia relatório nenhum.
    const fetchFn = vi.fn().mockResolvedValue(resposta(null, 502));

    const r = await avaliarApi({ apiUrl: 'https://api.teste', fetchFn });

    expect(r).toHaveLength(1);
    expect(r[0]?.regra).toBe('api-fora');
    expect(r[0]?.severidade).toBe('critico');
  });

  it('aceita 503 como resposta legítima — é o caso que mais interessa alertar', async () => {
    const fetchFn = vi.fn().mockResolvedValue(resposta(relatorio('falho'), 503));

    const r = await avaliarApi({ apiUrl: 'https://api.teste', fetchFn });

    expect(r[0]?.regra).toBe('saude');
    expect(r[0]?.severidade).toBe('critico');
  });

  it('sem token de curadoria, não consulta /metricas', async () => {
    const fetchFn = vi.fn().mockResolvedValue(resposta(relatorio('ok')));

    await avaliarApi({ apiUrl: 'https://api.teste', fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.teste/saude');
  });

  it('com token, consulta /metricas e avalia performance', async () => {
    // `init` na assinatura para o teste inspecionar o header de autorização no
    // fim — é ele que a guarda de curadoria exige.
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) =>
      init && url.endsWith('/saude')
        ? resposta(relatorio('ok'))
        : resposta({
            performance: {
              geradoEm: '2026-07-28T00:00:00.000Z',
              processo: {
                uptimeS: 100,
                memoria: { rssMb: 470, heapUsadoMb: 400, heapTotalMb: 450 },
                cpu: { percentual: 5, usuarioMs: 1, sistemaMs: 1 },
              },
              banco: {},
              cache: {},
              http: {},
            },
          }),
    );

    const r = await avaliarApi({
      apiUrl: 'https://api.teste',
      curadoriaToken: 'token-secreto',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(r[0]?.regra).toBe('memoria');
    // O token vai como Bearer, do jeito que a guarda de curadoria espera.
    const cabecalhos = fetchFn.mock.calls[1]?.[1] as { headers: Record<string, string> };
    expect(cabecalhos.headers.authorization).toBe('Bearer token-secreto');
  });

  it('/metricas recusado não cega o job — as regras de saúde seguem valendo', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/saude') ? resposta(relatorio('degradado')) : resposta(null, 403),
    );

    const r = await avaliarApi({
      apiUrl: 'https://api.teste',
      curadoriaToken: 'token-errado',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(r[0]?.regra).toBe('saude');
  });

  it('normaliza a barra final da URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(resposta(relatorio('ok')));

    await avaliarApi({ apiUrl: 'https://api.teste///', fetchFn });

    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.teste/saude');
  });
});
