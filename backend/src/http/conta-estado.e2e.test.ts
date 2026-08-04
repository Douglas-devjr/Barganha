/**
 * C13.2 — E2E de `GET /conta/estado` pela borda HTTP: rota PRIVADA (Bearer),
 * exigindo autenticação, e o corte gratis/plus com base na linha (ausente ou
 * presente) em `assinatura`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { ServicoConta } from '../auth/servico-conta';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { RegistroParsers } from '../parsers/registro';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ServicoAssinatura } from '../servicos/servico-assinatura';
import { ServicoSync } from '../sync/servico-sync';
import { construirServidor } from './servidor';

const repo = new RepositorioMemoria();
const registro = new RegistroParsers([]);
const processador = new ProcessadorCupom(repo, registro, new Anonimizador(repo));
const fila = new FilaMemoria(() => Promise.resolve(), { dormir: () => Promise.resolve() });
const app = construirServidor({
  servicoIngestao: new ServicoIngestao(repo, fila, processador),
  servicoConsulta: new ServicoConsulta(repo, repo),
  servicoSync: new ServicoSync(repo),
  servicoConta: new ServicoConta(repo),
  servicoAssinatura: new ServicoAssinatura(repo),
  autenticacao: new Autenticador(repo),
});

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

async function criarConta(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/conta/anonima' });
  return r.json().usuarioId as string;
}

describe('GET /conta/estado (C13.2)', () => {
  it('sem Bearer → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/conta/estado' });
    expect(r.statusCode).toBe(401);
  });

  it('conta sem linha em assinatura → { plano: "gratis" }', async () => {
    const usuarioId = await criarConta();

    const r = await app.inject({
      method: 'GET',
      url: '/conta/estado',
      headers: { authorization: `Bearer ${usuarioId}` },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ plano: 'gratis' });
  });

  it('conta com linha plus válida → { plano: "plus", validoAte }', async () => {
    const usuarioId = await criarConta();
    const validoAte = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    repo.semearAssinatura(usuarioId, { plano: 'plus', validoAte });

    const r = await app.inject({
      method: 'GET',
      url: '/conta/estado',
      headers: { authorization: `Bearer ${usuarioId}` },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ plano: 'plus', validoAte });
  });

  it('conta com linha plus expirada → { plano: "gratis" } (nunca confia num plus vencido)', async () => {
    const usuarioId = await criarConta();
    const passado = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    repo.semearAssinatura(usuarioId, { plano: 'plus', validoAte: passado });

    const r = await app.inject({
      method: 'GET',
      url: '/conta/estado',
      headers: { authorization: `Bearer ${usuarioId}` },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ plano: 'gratis' });
  });

  it('Bearer inválido (conta inexistente) → 401', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/conta/estado',
      headers: { authorization: 'Bearer id-que-nao-existe' },
    });
    expect(r.statusCode).toBe(401);
  });
});
