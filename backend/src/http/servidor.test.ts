import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { ServicoConta } from '../auth/servico-conta';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { RegistroParsers } from '../parsers/registro';
import { ParserRj } from '../parsers/rj';
import { ParserSp } from '../parsers/sp';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ClienteSefazMemoria } from '../sefaz/cliente-sefaz-memoria';
import { ServicoSync } from '../sync/servico-sync';
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
  const app = construirServidor({
    servicoIngestao,
    servicoConsulta: new ServicoConsulta(repo, repo),
    servicoSync: new ServicoSync(repo),
    servicoConta: new ServicoConta(repo),
    autenticacao: new Autenticador(repo),
  });
  return { app, repo, fila };
}

const { app, repo, fila } = montarApp();
let usuarioId: string;

beforeAll(async () => {
  await app.ready();
  const r = await app.inject({ method: 'POST', url: '/conta/anonima' });
  usuarioId = r.json().usuarioId;
});
afterAll(async () => {
  await app.close();
});

const auth = () => ({ authorization: `Bearer ${usuarioId}` });

describe('Servidor HTTP', () => {
  it('GET /saude responde ok', async () => {
    const r = await app.inject({ method: 'GET', url: '/saude' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });

  it('POST /conta/anonima cria conta (201) com usuarioId', async () => {
    const r = await app.inject({ method: 'POST', url: '/conta/anonima' });
    expect(r.statusCode).toBe(201);
    expect(r.json().usuarioId).toBeTruthy();
  });

  describe('Ingestão (C2.1)', () => {
    it('aceita o QR (202) com conta válida e processa em background', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/ingestao/qr',
        headers: auth(),
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

    it('rejeita sem credencial (401)', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/ingestao/qr',
        payload: { qrPayload: QR_RJ, capturadoEm: '2026-06-27T12:00:00.000Z' },
      });
      expect(r.statusCode).toBe(401);
    });

    it('rejeita conta inexistente (401)', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/ingestao/qr',
        headers: { authorization: 'Bearer conta-fantasma' },
        payload: { qrPayload: QR_RJ, capturadoEm: '2026-06-27T12:00:00.000Z' },
      });
      expect(r.statusCode).toBe(401);
    });

    it('GET /ingestao/cupom/:id devolve a nota processada ao dono', async () => {
      const ing = await app.inject({
        method: 'POST',
        url: '/ingestao/qr',
        headers: auth(),
        payload: { qrPayload: QR_RJ, capturadoEm: '2026-06-27T12:00:00.000Z' },
      });
      const cupomId = ing.json().cupomId as string;
      await fila.ociosa();

      const r = await app.inject({
        method: 'GET',
        url: `/ingestao/cupom/${cupomId}`,
        headers: auth(),
      });
      expect(r.statusCode).toBe(200);
      const corpo = r.json();
      expect(corpo.status).toBe('processado');
      expect(corpo.itens.length).toBeGreaterThan(0);
      expect(corpo.loja?.cnpj).toBeTruthy();
    });

    it('GET /ingestao/cupom/:id rejeita sem credencial (401)', async () => {
      const r = await app.inject({ method: 'GET', url: '/ingestao/cupom/qualquer' });
      expect(r.statusCode).toBe(401);
    });

    it('GET /ingestao/cupom/:id de outro dono responde 404', async () => {
      const ing = await app.inject({
        method: 'POST',
        url: '/ingestao/qr',
        headers: auth(),
        payload: { qrPayload: QR_RJ, capturadoEm: '2026-06-27T12:00:00.000Z' },
      });
      const cupomId = ing.json().cupomId as string;

      const outra = await app.inject({ method: 'POST', url: '/conta/anonima' });
      const r = await app.inject({
        method: 'GET',
        url: `/ingestao/cupom/${cupomId}`,
        headers: { authorization: `Bearer ${outra.json().usuarioId}` },
      });
      expect(r.statusCode).toBe(404);
    });

    it('rejeita corpo sem qrPayload (400 — schema)', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/ingestao/qr',
        headers: auth(),
        payload: { capturadoEm: '2026-06-27T12:00:00.000Z' },
      });
      expect(r.statusCode).toBe(400);
    });

    it('rejeita QR sem chave válida (400 — domínio)', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/ingestao/qr',
        headers: auth(),
        payload: { qrPayload: 'lixo', capturadoEm: '2026-06-27T12:00:00.000Z' },
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('Consulta de preço (C4.1) — anônima', () => {
    it('devolve a estatística e o escopo resolvido', async () => {
      const pid = await repo.casarPorEan('7891234567890', {
        descricaoNormalizada: 'LEITE INTEGRAL 1L',
        unidadeBase: 'L',
      });
      await repo.upsertEstatisticas([
        {
          produtoCanonicoId: pid,
          escopo: 'municipio',
          escopoId: 'RJ:Rio de Janeiro',
          unidadeBase: 'L',
          mediana: 5,
          p25: 4.5,
          p75: 5.5,
          minimo: 4,
          maximo: 6,
          nObservacoes: 8,
        },
      ]);

      const r = await app.inject({
        method: 'POST',
        url: '/consulta/preco',
        payload: { ean: '7891234567890', municipio: 'Rio de Janeiro', uf: 'RJ' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().escopoResolvido).toBe('municipio');
    });

    it('404 quando o produto não existe', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/consulta/preco',
        payload: { ean: 'inexistente' },
      });
      expect(r.statusCode).toBe(404);
    });

    it('400 sem ean nem nome (schema)', async () => {
      const r = await app.inject({ method: 'POST', url: '/consulta/preco', payload: { uf: 'RJ' } });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('Delta sync (C4.2) — anônimo', () => {
    it('devolve o delta no escopo + cursor', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/sync/estatisticas',
        payload: { municipios: ['RJ:Rio de Janeiro'] },
      });
      expect(r.statusCode).toBe(200);
      const corpo = r.json();
      expect(corpo.estatisticas.length).toBeGreaterThanOrEqual(1);
      expect(corpo.cursor).toBeTruthy();
    });
  });
});
