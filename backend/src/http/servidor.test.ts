import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { ServicoConta } from '../auth/servico-conta';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { TelemetriaMemoria } from '../observabilidade/telemetria-memoria';
import { RegistroParsers } from '../parsers/registro';
import { ParserRj } from '../parsers/rj';
import { ParserSp } from '../parsers/sp';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ControleRollout } from '../rollout/controle-rollout';
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
  const telemetria = new TelemetriaMemoria();
  const rollout = new ControleRollout(['RJ', 'SP']);
  const processador = new ProcessadorCupom(repo, registro, new Anonimizador(repo), {
    rollout,
    telemetria,
  });
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
    metricas: telemetria,
  });
  return { app, repo, fila, telemetria };
}

const { app, repo, fila, telemetria } = montarApp();
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
      // 3 itens da nota do RJ: 2 casados por EAN + 1 pela descrição (sem EAN).
      expect(repo.observacoesDoPool()).toHaveLength(3);
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
          escopoId: 'RJ:RIO DE JANEIRO',
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
        payload: { municipios: ['RJ:RIO DE JANEIRO', 'RJ'] },
      });
      expect(r.statusCode).toBe(200);
      const corpo = r.json();
      expect(corpo.estatisticas.length).toBeGreaterThanOrEqual(1);
      expect(corpo.cursor).toBeTruthy();
    });
  });

  describe('Métricas (C10.2) — observabilidade', () => {
    it('GET /metricas reflete os contadores de parsing por estado', async () => {
      // Os testes de ingestão acima já processaram cupons do RJ.
      const r = await app.inject({ method: 'GET', url: '/metricas' });
      expect(r.statusCode).toBe(200);
      const corpo = r.json();
      expect(corpo.geradoEm).toBeTruthy();
      expect(corpo.porUf.RJ.processado).toBeGreaterThanOrEqual(1);
      // O endpoint espelha a fonte de telemetria injetada.
      expect(corpo.totais.processado).toBe(telemetria.snapshot().totais.processado);
    });
  });
});

describe('Apagar conta (C4.3.1) — direito ao apagamento', () => {
  function montarComExclusao() {
    const repo = new RepositorioMemoria();
    const fila = new FilaMemoria(() => Promise.resolve(), { dormir: () => Promise.resolve() });
    const apagados: string[] = [];
    const app = construirServidor({
      servicoIngestao: new ServicoIngestao(repo, fila),
      servicoConsulta: new ServicoConsulta(repo, repo),
      servicoSync: new ServicoSync(repo),
      servicoConta: new ServicoConta(repo),
      autenticacao: new Autenticador(repo),
      gerenciadorConta: {
        apagar: (id) => {
          apagados.push(id);
          return Promise.resolve();
        },
      },
    });
    return { app, apagados };
  }

  it('apaga a conta autenticada (204) e delega ao gerenciador', async () => {
    const { app, apagados } = montarComExclusao();
    await app.ready();
    const conta = await app.inject({ method: 'POST', url: '/conta/anonima' });
    const usuarioId = conta.json().usuarioId as string;

    const r = await app.inject({
      method: 'DELETE',
      url: '/conta',
      headers: { authorization: `Bearer ${usuarioId}` },
    });
    expect(r.statusCode).toBe(204);
    expect(apagados).toEqual([usuarioId]);
    await app.close();
  });

  it('rejeita exclusão sem credencial (401)', async () => {
    const { app, apagados } = montarComExclusao();
    await app.ready();
    const r = await app.inject({ method: 'DELETE', url: '/conta' });
    expect(r.statusCode).toBe(401);
    expect(apagados).toHaveLength(0);
    await app.close();
  });
});
