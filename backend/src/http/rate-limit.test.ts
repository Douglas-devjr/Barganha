import { describe, expect, it } from 'vitest';

import { Autenticador } from '../auth/autenticador';
import { ServicoConta } from '../auth/servico-conta';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoSync } from '../sync/servico-sync';
import { LimitadorJanelaFixa } from './rate-limit';
import { construirServidor, LIMITES_PADRAO } from './servidor';

describe('LimitadorJanelaFixa (C9.3.2)', () => {
  it('libera até o máximo e barra o excedente dentro da janela', () => {
    const t = 1_000;
    const lim = new LimitadorJanelaFixa({ janelaMs: 100, maximo: 3, agora: () => t });

    expect(lim.permitir('ip-1')).toBe(true);
    expect(lim.permitir('ip-1')).toBe(true);
    expect(lim.permitir('ip-1')).toBe(true);
    expect(lim.permitir('ip-1')).toBe(false); // 4ª na mesma janela
  });

  it('zera a contagem quando a janela vira', () => {
    let t = 0;
    const lim = new LimitadorJanelaFixa({ janelaMs: 100, maximo: 1, agora: () => t });

    expect(lim.permitir('ip-1')).toBe(true);
    expect(lim.permitir('ip-1')).toBe(false);
    t += 100; // nova janela
    expect(lim.permitir('ip-1')).toBe(true);
  });

  it('conta cada chave isoladamente', () => {
    const t = 0;
    const lim = new LimitadorJanelaFixa({ janelaMs: 100, maximo: 1, agora: () => t });

    expect(lim.permitir('ip-1')).toBe(true);
    expect(lim.permitir('ip-2')).toBe(true); // outra chave, próprio orçamento
    expect(lim.permitir('ip-1')).toBe(false);
  });
});

function montarApp(limiteConta: number) {
  const repo = new RepositorioMemoria();
  const fila = new FilaMemoria(() => Promise.resolve(), { dormir: () => Promise.resolve() });
  return construirServidor({
    servicoIngestao: new ServicoIngestao(repo, fila),
    servicoConsulta: new ServicoConsulta(repo, repo),
    servicoSync: new ServicoSync(repo),
    servicoConta: new ServicoConta(repo),
    autenticacao: new Autenticador(repo),
    limites: { ...LIMITES_PADRAO, conta: { janelaMs: 60_000, maximo: limiteConta } },
  });
}

describe('Rate-limit no servidor (C9.3.2)', () => {
  it('responde 429 quando a criação de conta estoura o teto', async () => {
    const app = montarApp(2);
    await app.ready();
    try {
      const a = await app.inject({ method: 'POST', url: '/conta/anonima' });
      const b = await app.inject({ method: 'POST', url: '/conta/anonima' });
      const c = await app.inject({ method: 'POST', url: '/conta/anonima' });

      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      expect(c.statusCode).toBe(429);
      expect(c.json().erro).toMatch(/muitas requisições/i);
    } finally {
      await app.close();
    }
  });
});

/** App com teto BAIXO nos endpoints privados, para exercitar o limite por conta. */
function montarAppPrivado(limiteIngestao: number) {
  const repo = new RepositorioMemoria();
  const fila = new FilaMemoria(() => Promise.resolve(), { dormir: () => Promise.resolve() });
  const app = construirServidor({
    servicoIngestao: new ServicoIngestao(repo, fila),
    servicoConsulta: new ServicoConsulta(repo, repo),
    servicoSync: new ServicoSync(repo),
    servicoConta: new ServicoConta(repo),
    autenticacao: new Autenticador(repo),
    limites: {
      ...LIMITES_PADRAO,
      ingestao: { janelaMs: 60_000, maximo: limiteIngestao },
    },
  });
  return { app, repo };
}

const QR =
  'https://www.fazenda.rj.gov.br/nfce/qrcode?p=33260612345678000199650010000000011000000016|2|1';

const ingerir = (app: ReturnType<typeof construirServidor>, token: string) =>
  app.inject({
    method: 'POST',
    url: '/ingestao/qr',
    headers: { authorization: `Bearer ${token}` },
    payload: { qrPayload: QR, capturadoEm: new Date().toISOString() },
  });

describe('Rate-limit dos endpoints privados — por CONTA autenticada', () => {
  it('conta o teto por usuário, e o excedente vira 429', async () => {
    const { app, repo } = montarAppPrivado(2);
    await app.ready();
    try {
      const usuarioId = await repo.criarAnonimo();
      expect((await ingerir(app, usuarioId)).statusCode).toBe(202);
      expect((await ingerir(app, usuarioId)).statusCode).toBe(202);
      expect((await ingerir(app, usuarioId)).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('REGRESSÃO: trocar o Bearer a cada chamada NÃO ganha janela nova', async () => {
    // O bug: o limitador rodava no `onRequest`, ANTES da autenticação, e
    // chaveava pelo token CRU. Bastava mandar um Bearer diferente por
    // requisição para nunca estourar o teto — e ainda inchava o mapa com um JWT
    // inteiro por chave. Agora a chave é o usuarioId já verificado, então um
    // token inventado morre no 401 e nunca alcança o orçamento de ninguém.
    const { app, repo } = montarAppPrivado(2);
    await app.ready();
    try {
      const usuarioId = await repo.criarAnonimo();

      // Tokens inventados: barrados por autenticação, não consomem o teto.
      for (let i = 0; i < 20; i++) {
        expect((await ingerir(app, `token-forjado-${i}`)).statusCode).toBe(401);
      }

      // A conta real continua com o orçamento intacto — e ele é respeitado.
      expect((await ingerir(app, usuarioId)).statusCode).toBe(202);
      expect((await ingerir(app, usuarioId)).statusCode).toBe(202);
      expect((await ingerir(app, usuarioId)).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('contas diferentes têm orçamentos independentes', async () => {
    const { app, repo } = montarAppPrivado(1);
    await app.ready();
    try {
      const a = await repo.criarAnonimo();
      const b = await repo.criarAnonimo();
      expect((await ingerir(app, a)).statusCode).toBe(202);
      expect((await ingerir(app, a)).statusCode).toBe(429);
      expect((await ingerir(app, b)).statusCode).toBe(202);
    } finally {
      await app.close();
    }
  });
});
