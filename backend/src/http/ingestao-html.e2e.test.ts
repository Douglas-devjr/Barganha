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
import { digitoVerificadorChave } from '../parsers/chave-acesso';
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
    expect(r.json().codigo).toBe('desafio');
    expect(repo.statusDoCupom(cupomId)).toBe('qr_capturado');
  });

  it('página avisoErro (reCAPTCHA recusado) → 422 erro_portal e cupom NÃO vira falha', async () => {
    const usuarioId = await novaConta();
    const cupomId = await ingerirQr(usuarioId);

    const r = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: {
        html: '<html class="ui-mobile"><body><div class="ui-page"><div class="avisoErro"></div><iframe></iframe></div></body></html>',
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().codigo).toBe('erro_portal');
    // Antes deste tratamento, a página de erro ia ao parser e o cupom era
    // marcado `falha` PERMANENTE — mesmo quando a tentativa seguinte passaria.
    expect(repo.statusDoCupom(cupomId)).toBe('qr_capturado');
  });

  it('página de transição (nem desafio, nem nota) → 422 e cupom NÃO vira falha', async () => {
    const usuarioId = await novaConta();
    const cupomId = await ingerirQr(usuarioId);

    const r = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: '<html><body><p>Aguarde, carregando a consulta…</p></body></html>' },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().codigo).toBe('desafio');
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

  it('backfill: cupom processado SEM totais ganha desconto/pago pelo HTML, sem duplicar o pool', async () => {
    const usuarioId = await novaConta();
    const cupomId = await ingerirQr(usuarioId);

    // 1º processamento com uma nota SEM a seção #totalNota (como as processadas
    // antes do recurso de totais existir): fica `processado` com totais nulos.
    const semTotais = HTML_ENCAT_COM_DESCONTO.replace(
      /<div id="totalNota">[\s\S]*?<\/div>\s*<div id="infos">/,
      '<div id="infos">',
    );
    const r1 = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: semTotais },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().status).toBe('processado');
    expect(r1.json().descontoTotal).toBeUndefined();
    const poolAposProcessar = repo.observacoesDoPool().length;

    // 2º envio (reescaneando o mesmo cupom), agora com a nota completa: só os
    // totais entram — itens/pool intactos.
    const r2 = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: HTML_ENCAT_COM_DESCONTO },
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().descontoTotal).toBe(1.9);
    expect(r2.json().valorPago).toBe(15);
    expect(repo.observacoesDoPool()).toHaveLength(poolAposProcessar);

    // 3º envio com outro desconto: totais JÁ gravados nunca são sobrescritos.
    const adulterado = HTML_ENCAT_COM_DESCONTO.replace('1,90', '9,99');
    const r3 = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: adulterado },
    });
    expect(r3.statusCode).toBe(200);
    expect(r3.json().descontoTotal).toBe(1.9);
  });

  it('backfill: página de desafio num cupom processado → 422 (coletor segue aguardando)', async () => {
    const usuarioId = await novaConta();
    const cupomId = await ingerirQr(usuarioId);
    const semTotais = HTML_ENCAT_COM_DESCONTO.replace(
      /<div id="totalNota">[\s\S]*?<\/div>\s*<div id="infos">/,
      '<div id="infos">',
    );
    await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: semTotais },
    });

    const r = await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: '<html><body><script>grecaptcha.execute(k,{})</script></body></html>' },
    });
    expect(r.statusCode).toBe(422);
    expect(repo.statusDoCupom(cupomId)).toBe('processado');
  });

  it('C9.2.1: duas contas com o MESMO cupom físico → pool recebe UMA vez; histórico dos dois existe', async () => {
    // Chave própria deste teste (nNF distinto, DV recalculado) — mesmo emitente.
    const chave43 = '33260612345678000199650010000007771000000019'.slice(0, 43);
    const qr = `https://www.fazenda.rj.gov.br/nfce/qrcode?p=${chave43}${digitoVerificadorChave(chave43)}|2|1`;

    const ingerir = async (usuarioId: string): Promise<string> => {
      const r = await app.inject({
        method: 'POST',
        url: '/ingestao/qr',
        headers: { authorization: `Bearer ${usuarioId}` },
        payload: { qrPayload: qr, capturadoEm: CAPTURA },
      });
      return r.json().cupomId as string;
    };
    const enviarNota = (usuarioId: string, cupomId: string) =>
      app.inject({
        method: 'POST',
        url: urlHtml(cupomId),
        headers: { authorization: `Bearer ${usuarioId}` },
        payload: { html: HTML_RJ },
      });

    const contaA = await novaConta();
    const contaB = await novaConta();
    const cupomA = await ingerir(contaA);
    const cupomB = await ingerir(contaB);
    expect(cupomA).not.toBe(cupomB); // idempotência é POR usuário — dois registros privados.

    const rA = await enviarNota(contaA, cupomA);
    expect(rA.statusCode).toBe(200);
    expect(rA.json().status).toBe('processado');
    const poolAposA = repo.observacoesDoPool().length;

    const rB = await enviarNota(contaB, cupomB);
    expect(rB.statusCode).toBe(200);
    // B tem a nota COMPLETA no histórico privado…
    expect(rB.json().status).toBe('processado');
    expect(rB.json().itens.length).toBeGreaterThan(0);
    // …mas o pool NÃO cresce: a chave já publicou (mediana da região intacta).
    expect(repo.observacoesDoPool()).toHaveLength(poolAposA);
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

describe('GET /ingestao/cupons — rehidratação do histórico (restore, docs/04)', () => {
  it('exige autenticação (401 sem Bearer)', async () => {
    const r = await app.inject({ method: 'GET', url: '/ingestao/cupons' });
    expect(r.statusCode).toBe(401);
  });

  it('devolve só os cupons do dono, com o QR e a captura, para o app reconstruir o espelho', async () => {
    const usuarioId = await novaConta();
    const cupomId = await ingerirQr(usuarioId);
    await app.inject({
      method: 'POST',
      url: urlHtml(cupomId),
      headers: { authorization: `Bearer ${usuarioId}` },
      payload: { html: HTML_RJ },
    });

    const r = await app.inject({
      method: 'GET',
      url: '/ingestao/cupons',
      headers: { authorization: `Bearer ${usuarioId}` },
    });

    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.cupons).toHaveLength(1);
    expect(corpo.cupons[0].cupomId).toBe(cupomId);
    expect(corpo.cupons[0].qrPayload).toBe(QR_RJ);
    expect(corpo.cupons[0].capturadoEm).toBe(CAPTURA);
    expect(corpo.cupons[0].itens).toHaveLength(3);
  });

  it('conta recém-criada tem histórico vazio (após excluir a conta, seria o mesmo)', async () => {
    const usuarioId = await novaConta();
    const r = await app.inject({
      method: 'GET',
      url: '/ingestao/cupons',
      headers: { authorization: `Bearer ${usuarioId}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().cupons).toHaveLength(0);
    expect(r.json().proximoCursor).toBeUndefined();
  });
});
