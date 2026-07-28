/**
 * C10.4 — Request ID no contrato HTTP.
 *
 * O ponto do bloco é a CORRELAÇÃO: o id que o app mostra na tela tem que ser o
 * mesmo que aparece no log do servidor. Por isso os testes olham o eco (o
 * servidor devolveu o que recebeu?) e não apenas a presença de um id qualquer —
 * um servidor que gera um id novo a cada request "tem request id" e mesmo assim
 * não rastreia nada.
 */

import { HEADER_REQUEST_ID } from '@barganha/shared';
import { describe, expect, it } from 'vitest';

import { Autenticador } from '../auth/autenticador';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoSync } from '../sync/servico-sync';
import { construirServidor } from './servidor';

function montarApp() {
  const repo = new RepositorioMemoria();
  const fila = new FilaMemoria(() => Promise.resolve(), { dormir: () => Promise.resolve() });
  return construirServidor({
    servicoIngestao: new ServicoIngestao(repo, fila),
    servicoConsulta: new ServicoConsulta(repo, repo),
    servicoSync: new ServicoSync(repo),
    autenticacao: new Autenticador(repo),
  });
}

const app = montarApp();

describe('Request ID', () => {
  it('devolve o cabeçalho em resposta de SUCESSO', async () => {
    // Não só no erro: "ficou lento" e "veio o preço errado" são relatos sem
    // erro nenhum, e sem o id não há como achar aquela requisição.
    const r = await app.inject({ method: 'GET', url: '/saude' });

    expect(r.statusCode).toBe(200);
    expect(r.headers[HEADER_REQUEST_ID]).toBeTruthy();
  });

  it('ECOA o id enviado pelo cliente — é isto que correlaciona as duas pontas', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/saude',
      headers: { [HEADER_REQUEST_ID]: 'lz3k9x-a1b2c3d4' },
    });

    expect(r.headers[HEADER_REQUEST_ID]).toBe('lz3k9x-a1b2c3d4');
  });

  it('DESCARTA id malformado e gera um próprio (anti-forja de log)', async () => {
    const veneno = 'abc\n{"level":"error","action":"forjado"}';

    const r = await app.inject({
      method: 'GET',
      url: '/saude',
      headers: { [HEADER_REQUEST_ID]: veneno },
    });

    expect(r.headers[HEADER_REQUEST_ID]).toBeTruthy();
    expect(r.headers[HEADER_REQUEST_ID]).not.toBe(veneno);
  });

  it('gera ids distintos entre requisições', async () => {
    const a = await app.inject({ method: 'GET', url: '/saude' });
    const b = await app.inject({ method: 'GET', url: '/saude' });

    // O padrão do Fastify é um contador que zera a cada boot; no free tier, onde
    // a instância dorme várias vezes ao dia, isso repete ids entre incidentes.
    expect(a.headers[HEADER_REQUEST_ID]).not.toBe(b.headers[HEADER_REQUEST_ID]);
  });

  it('inclui o requestId no CORPO do erro de validação (400)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/consulta/preco',
      payload: { nada: true },
      headers: { [HEADER_REQUEST_ID]: 'id-de-teste-400' },
    });

    expect(r.statusCode).toBe(400);
    // No corpo, não só no cabeçalho: é o corpo que sobrevive até a tela do app.
    expect(r.json().requestId).toBe('id-de-teste-400');
  });

  it('carimba o cabeçalho mesmo quando nenhum handler roda (404)', async () => {
    // Este caminho nunca chega ao tratador de erros do domínio. Se o carimbo
    // dependesse dele, todo request barrado antes do handler — 404, 401, 429 —
    // ficaria sem rastro. Por isso ele vive no hook `onRequest`.
    const r = await app.inject({
      method: 'GET',
      url: '/rota-que-nao-existe',
      headers: { [HEADER_REQUEST_ID]: 'id-de-teste-404' },
    });

    expect(r.statusCode).toBe(404);
    expect(r.headers[HEADER_REQUEST_ID]).toBe('id-de-teste-404');
  });
});
