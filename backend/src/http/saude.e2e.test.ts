/**
 * C10.4 — Contrato HTTP das duas rotas de saúde.
 *
 * O que importa aqui é o CÓDIGO DE STATUS, não o corpo: é ele que o Render lê
 * para decidir se o deploy sobe, e a diferença entre `/saude` e `/saude/pronto`
 * é justamente essa decisão. Um teste de corpo passaria feliz com os dois
 * devolvendo 200 sempre — que é o bug que este arquivo existe para pegar.
 */

import { describe, expect, it } from 'vitest';

import { Autenticador } from '../auth/autenticador';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { MonitorSaude, type Sonda } from '../observabilidade/saude';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoSync } from '../sync/servico-sync';
import { construirServidor } from './servidor';

function montarApp(sondas: Sonda[]) {
  const repo = new RepositorioMemoria();
  const fila = new FilaMemoria(() => Promise.resolve(), { dormir: () => Promise.resolve() });
  return construirServidor({
    servicoIngestao: new ServicoIngestao(repo, fila),
    servicoConsulta: new ServicoConsulta(repo, repo),
    servicoSync: new ServicoSync(repo),
    autenticacao: new Autenticador(repo),
    saude: new MonitorSaude(sondas, { versao: 'sha-teste', ambiente: 'teste', cacheMs: 0 }),
  });
}

const sonda = (nome: string, critica: boolean, estado: 'ok' | 'degradado' | 'falho'): Sonda => ({
  nome,
  critica,
  verificar: () => Promise.resolve({ estado }),
});

describe('GET /saude (liveness + detalhe)', () => {
  it('devolve 200 e o relatório completo quando saudável', async () => {
    const app = montarApp([sonda('banco', true, 'ok')]);

    const r = await app.inject({ method: 'GET', url: '/saude' });

    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.ok).toBe(true);
    expect(corpo.status).toBe('ok');
    expect(corpo.versao).toBe('sha-teste');
    expect(corpo.verificacoes[0]).toMatchObject({ nome: 'banco', estado: 'ok' });
    expect(typeof corpo.uptimeS).toBe('number');
  });

  it('devolve 200 mesmo DEGRADADO — o cron de 10 min não pode virar alarme falso', async () => {
    const app = montarApp([sonda('telemetria', false, 'degradado')]);

    const r = await app.inject({ method: 'GET', url: '/saude' });

    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('degradado');
  });

  it('continua 200 mesmo FALHO: liveness é sobre o processo estar de pé', async () => {
    const app = montarApp([sonda('banco', true, 'falho')]);

    const r = await app.inject({ method: 'GET', url: '/saude' });

    expect(r.statusCode).toBe(200);
    // Mas o corpo não mente sobre o estado — quem investiga vê a verdade.
    expect(r.json().ok).toBe(false);
    expect(r.json().status).toBe('falho');
  });

  it('não exige autenticação — a sonda da plataforma não tem credencial', async () => {
    const app = montarApp([]);

    expect((await app.inject({ method: 'GET', url: '/saude' })).statusCode).toBe(200);
  });
});

describe('GET /saude/pronto (readiness — o gate do deploy)', () => {
  it('200 quando saudável', async () => {
    const app = montarApp([sonda('banco', true, 'ok')]);

    const r = await app.inject({ method: 'GET', url: '/saude/pronto' });

    expect(r.statusCode).toBe(200);
    expect(r.json().pronto).toBe(true);
  });

  it('200 quando DEGRADADO — Supabase oscilando não pode barrar o hotfix', async () => {
    const app = montarApp([sonda('banco', true, 'degradado')]);

    expect((await app.inject({ method: 'GET', url: '/saude/pronto' })).statusCode).toBe(200);
  });

  it('503 quando FALHO — é isto que reprova o deploy e dispara o rollback', async () => {
    const app = montarApp([sonda('parsers', true, 'falho')]);

    const r = await app.inject({ method: 'GET', url: '/saude/pronto' });

    expect(r.statusCode).toBe(503);
    expect(r.json().pronto).toBe(false);
    expect(r.json().verificacoes[0].nome).toBe('parsers');
  });
});
