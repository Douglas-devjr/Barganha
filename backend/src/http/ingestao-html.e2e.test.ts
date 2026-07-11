/**
 * C2.6 — Teste e2e da ingestão por HTML pela borda HTTP.
 *
 * Cobre o caminho em que o portal exige navegador/reCAPTCHA (ex.: RJ): o app
 * registra o cupom por QR, colhe o HTML da nota no WebView e o envia para o
 * backend PARSEAR (nunca o app). Verifica auth (401), escopo do dono (404),
 * HTML de desafio (422) e o sucesso (200 → `processado` com itens).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { Autenticador } from '../auth/autenticador';
import { ServicoConta } from '../auth/servico-conta';
import { ServicoConsulta } from '../consulta/servico-consulta';
import type { FilaProcessamento } from '../fila/tipos';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { RegistroParsers } from '../parsers/registro';
import { ParserRj } from '../parsers/rj';
import type { ClienteSefaz } from '../parsers/tipos';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ServicoSync } from '../sync/servico-sync';
import { construirServidor } from './servidor';

const HTML_RJ = readFileSync(
  fileURLToPath(new URL('../parsers/__fixtures__/rj-nota-1.html', import.meta.url)),
  'utf8',
);
const QR_RJ =
  'https://www.fazenda.rj.gov.br/nfce/qrcode?p=33260612345678000199650010000000011000000016|2|1';
const CAPTURA = '2026-06-27T12:00:00.000Z';

/** Nota ENCAT mínima do MESMO emitente da chave (12345678000199), com desconto. */
const HTML_ENCAT_COM_DESCONTO = `
<div id="conteudo">
  <div class="txtTopo">SUPERMERCADO MARACANA LTDA</div>
  <div class="text">CNPJ: 12.345.678/0001-99</div>
  <div class="text">Rua do Mercado, 10, Centro, RIO DE JANEIRO, RJ</div>
  <table id="tabResult">
    <tr><td>
      <span class="txtTit">CAFE TORRADO 500G</span>
      <span class="RCod">(Código: 7890000000017)</span>
      <span class="Rqtd"><strong>Qtde.:</strong>1</span>
      <span class="RUN"><strong>UN:</strong> UN</span>
      <span class="RvlUnit"><strong>Vl. Unit.:</strong> 16,90</span>
    </td><td><span class="valor">16,90</span></td></tr>
  </table>
  <div id="totalNota">
    <div id="linhaTotal"><label>Valor total R$:</label><span class="totalNumb">16,90</span></div>
    <div id="linhaTotal"><label>Descontos R$:</label><span class="totalNumb">1,90</span></div>
    <div id="linhaTotal"><label>Valor a pagar R$:</label><span class="totalNumb">15,00</span></div>
  </div>
  <div id="infos"><ul><li><strong>Emissão:</strong> 20/06/2026 18:30:00</li></ul></div>
</div>`;

/** Mesma nota, mas de OUTRO emitente — CNPJ não bate com a chave do cupom. */
const HTML_OUTRO_EMITENTE = HTML_ENCAT_COM_DESCONTO.replace(
  'CNPJ: 12.345.678/0001-99',
  'CNPJ: 61.585.865/0001-51',
);

const repo = new RepositorioMemoria();
// Cliente SEFAZ nunca é chamado no caminho por HTML; a fila é no-op para o cupom
// ficar `qr_capturado` até a ingestão por HTML processá-lo (isola o caminho C2.6).
const clienteNulo: ClienteSefaz = { buscarConsulta: () => Promise.resolve('') };
const filaNoop: FilaProcessamento = { enfileirar: () => Promise.resolve() };
const registro = new RegistroParsers([new ParserRj(clienteNulo)]);
const processador = new ProcessadorCupom(repo, registro, new Anonimizador(repo));
const app = construirServidor({
  servicoIngestao: new ServicoIngestao(repo, filaNoop, processador),
  servicoConsulta: new ServicoConsulta(repo, repo),
  servicoSync: new ServicoSync(repo),
  servicoConta: new ServicoConta(repo),
  autenticacao: new Autenticador(repo),
});

async function novaConta(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/conta/anonima' });
  return r.json().usuarioId as string;
}

async function ingerirQr(usuarioId: string): Promise<string> {
  const r = await app.inject({
    method: 'POST',
    url: '/ingestao/qr',
    headers: { authorization: `Bearer ${usuarioId}` },
    payload: { qrPayload: QR_RJ, capturadoEm: CAPTURA },
  });
  return r.json().cupomId as string;
}

const urlHtml = (id: string): string => `/ingestao/cupom/${id}/html`;

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('POST /ingestao/cupom/:id/html (C2.6)', () => {
  it('exige autenticação (401 sem Bearer)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: urlHtml('qualquer'),
      payload: { html: 'x' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('parseia o HTML e devolve o cupom processado com itens', async () => {
    const usuarioId = await novaConta();
    const cupomId = await ingerirQr(usuarioId);

    const r = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: HTML_RJ },
    });

    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.status).toBe('processado');
    expect(corpo.uf).toBe('RJ');
    expect(corpo.itens).toHaveLength(3);
    expect(repo.statusDoCupom(cupomId)).toBe('processado');
  });

  it('não vaza cupom de outro dono (404)', async () => {
    const dono = await novaConta();
    const cupomId = await ingerirQr(dono);
    const intruso = await novaConta();

    const r = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${intruso}` },
      payload: { html: HTML_RJ },
    });
    expect(r.statusCode).toBe(404);
  });

  it('HTML ainda de desafio → 422 e cupom NÃO vira falha', async () => {
    const usuarioId = await novaConta();
    const cupomId = await ingerirQr(usuarioId);

    const r = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: '<html><body><script>grecaptcha.execute(k,{})</script></body></html>' },
    });
    expect(r.statusCode).toBe(422);
    expect(repo.statusDoCupom(cupomId)).toBe('qr_capturado');
  });

  it('devolve o desconto e o valor pago do cupom (persistidos no processamento)', async () => {
    const usuarioId = await novaConta();
    const cupomId = await ingerirQr(usuarioId);

    const r = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: HTML_ENCAT_COM_DESCONTO },
    });

    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.status).toBe('processado');
    expect(corpo.descontoTotal).toBe(1.9);
    expect(corpo.valorPago).toBe(15);
  });

  it('nota de OUTRO emitente (CNPJ ≠ chave) → falha, nada entra no pool', async () => {
    const usuarioId = await novaConta();
    const cupomId = await ingerirQr(usuarioId);
    const poolAntes = repo.observacoesDoPool().length;

    const r = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: HTML_OUTRO_EMITENTE },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('falha');
    expect(repo.statusDoCupom(cupomId)).toBe('falha');
    expect(repo.motivoDaFalha(cupomId)).toMatch(/CNPJ/);
    expect(repo.observacoesDoPool()).toHaveLength(poolAntes);
  });
});
