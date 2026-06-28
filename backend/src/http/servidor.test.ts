import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { RegistroParsers } from '../parsers/registro';
import { ParserRj } from '../parsers/rj';
import { ParserSp } from '../parsers/sp';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ClienteSefazMemoria } from '../sefaz/cliente-sefaz-memoria';
import { construirServidor } from './servidor';

const fix = (n: string): string =>
  readFileSync(fileURLToPath(new URL(`../parsers/__fixtures__/${n}`, import.meta.url)), 'utf8');

const QR_RJ =
  'https://www.fazenda.rj.gov.br/nfce/qrcode?p=33260612345678000199650010000000011000000016|2|1';

function montarApp() {
  const repo = new RepositorioMemoria();
  const cliente = new ClienteSefazMemoria({ RJ: fix('rj-nota-1.html'), SP: fix('sp-nota-1.html') });
  const registro = new RegistroParsers([new ParserRj(cliente), new ParserSp(cliente)]);
  const processador = new ProcessadorCupom(repo, registro, new Anonimizador(repo));
  const fila = new FilaMemoria((t) => processador.processar(t.cupomId), {
    dormir: () => Promise.resolve(),
  });
  const servicoIngestao = new ServicoIngestao(repo, fila);
  const app = construirServidor({ servicoIngestao });
  return { app, repo, fila };
}

const { app, repo, fila } = montarApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('Servidor HTTP de ingestão (C2.1)', () => {
  it('GET /saude responde ok', async () => {
    const r = await app.inject({ method: 'GET', url: '/saude' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });

  it('POST /ingestao/qr aceita o QR (202) e processa em background', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/ingestao/qr',
      headers: { 'x-usuario-id': 'user-1' },
      payload: { qrPayload: QR_RJ, capturadoEm: '2026-06-27T12:00:00.000Z' },
    });
    expect(r.statusCode).toBe(202);
    const corpo = r.json();
    expect(corpo.status).toBe('qr_capturado');
    expect(corpo.cupomId).toBeTruthy();

    await fila.ociosa();
    expect(repo.statusDoCupom(corpo.cupomId)).toBe('processado');
    expect(repo.observacoesDoPool()).toHaveLength(2);
  });

  it('rejeita sem usuário (401)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/ingestao/qr',
      payload: { qrPayload: QR_RJ, capturadoEm: '2026-06-27T12:00:00.000Z' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('rejeita corpo sem qrPayload (400 — schema)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/ingestao/qr',
      headers: { 'x-usuario-id': 'user-1' },
      payload: { capturadoEm: '2026-06-27T12:00:00.000Z' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejeita QR sem chave válida (400 — domínio)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/ingestao/qr',
      headers: { 'x-usuario-id': 'user-1' },
      payload: { qrPayload: 'lixo', capturadoEm: '2026-06-27T12:00:00.000Z' },
    });
    expect(r.statusCode).toBe(400);
  });
});
