import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { ChaveAcessoInvalidaError, HtmlDesafioError, PayloadQrInvalidoError } from '../erros';
import type { FilaProcessamento } from '../fila/tipos';
import { RegistroParsers } from '../parsers/registro';
import { ParserRj } from '../parsers/rj';
import type { ClienteSefaz } from '../parsers/tipos';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ProcessadorCupom } from '../processamento/processador-cupom';
import { ServicoIngestao } from './servico-ingestao';

const QR_RJ =
  'https://www.fazenda.rj.gov.br/nfce/qrcode?p=33260612345678000199650010000000011000000016|2|1';
const CAPTURA = { capturadoEm: '2026-06-27T12:00:00.000Z' };

// HTML da nota JÁ renderizada (o que um WebView colheria) — reusa o fixture do RJ.
const HTML_RJ = readFileSync(
  fileURLToPath(new URL('../parsers/__fixtures__/rj-nota-1.html', import.meta.url)),
  'utf8',
);

function filaFake(): FilaProcessamento {
  return { enfileirar: vi.fn().mockResolvedValue(undefined) };
}

// Cliente SEFAZ nunca é chamado no caminho por HTML (parseHtml não toca a rede).
const clienteSefazNulo: ClienteSefaz = { buscarConsulta: () => Promise.resolve('') };

/** Serviço com o processador ligado (ingestão por HTML, C2.6). */
function servicoComProcessador(repo: RepositorioMemoria): ServicoIngestao {
  const registro = new RegistroParsers([new ParserRj(clienteSefazNulo)]);
  const processador = new ProcessadorCupom(repo, registro, new Anonimizador(repo));
  return new ServicoIngestao(repo, filaFake(), processador);
}

describe('ServicoIngestao (C2.1)', () => {
  it('grava qr_capturado e enfileira o processamento', async () => {
    const repo = new RepositorioMemoria();
    const fila = filaFake();
    const res = await new ServicoIngestao(repo, fila).ingerir('user-1', {
      qrPayload: QR_RJ,
      ...CAPTURA,
    });

    expect(res.status).toBe('qr_capturado');
    expect(repo.statusDoCupom(res.cupomId)).toBe('qr_capturado');
    // A chave volta na resposta — o app a grava p/ idempotência local (docs/05).
    expect(res.chaveAcesso).toBe('33260612345678000199650010000000011000000016');
    // A tarefa leva a UF (do QR) para a telemetria por estado (C10.2).
    expect(fila.enfileirar).toHaveBeenCalledWith({ cupomId: res.cupomId, uf: 'RJ' });
  });

  it('é idempotente por chave: reenvio não cria cupom nem enfileira de novo', async () => {
    const repo = new RepositorioMemoria();
    const fila = filaFake();
    const servico = new ServicoIngestao(repo, fila);

    const r1 = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });
    const r2 = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });

    expect(r2.cupomId).toBe(r1.cupomId);
    expect(fila.enfileirar).toHaveBeenCalledTimes(1);
  });

  it('aceita QR de UF sem parser (guarda para reprocessamento)', async () => {
    // cUF 31 = MG (sem parser); a ingestão não rejeita.
    const QR_MG =
      'https://nfce.fazenda.mg.gov.br/portalnfce?p=31260612345678000199650010000000011000000011|2|1';
    const repo = new RepositorioMemoria();
    const res = await new ServicoIngestao(repo, filaFake()).ingerir('user-1', {
      qrPayload: QR_MG,
      ...CAPTURA,
    });
    expect(res.status).toBe('qr_capturado');
  });

  it('rejeita payload sem chave válida', async () => {
    const servico = new ServicoIngestao(new RepositorioMemoria(), filaFake());
    await expect(servico.ingerir('user-1', { qrPayload: 'lixo', ...CAPTURA })).rejects.toThrow(
      PayloadQrInvalidoError,
    );
  });

  it('rejeita chave com DV inválido', async () => {
    const servico = new ServicoIngestao(new RepositorioMemoria(), filaFake());
    // Mesmo prefixo da chave válida, mas com DV trocado (6 → 7).
    const qrRuim =
      'https://www.fazenda.rj.gov.br/nfce/qrcode?p=33260612345678000199650010000000011000000017|2|1';
    await expect(servico.ingerir('user-1', { qrPayload: qrRuim, ...CAPTURA })).rejects.toThrow(
      ChaveAcessoInvalidaError,
    );
  });
});

describe('ServicoIngestao.ingerirHtml (C2.6)', () => {
  it('parseia o HTML colhido, processa o cupom e devolve os itens', async () => {
    const repo = new RepositorioMemoria();
    const servico = servicoComProcessador(repo);
    const { cupomId } = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });

    const cupom = await servico.ingerirHtml('user-1', cupomId, HTML_RJ);

    expect(cupom?.status).toBe('processado');
    expect(cupom?.uf).toBe('RJ');
    expect(cupom?.loja?.cnpj).toBe('12345678000199');
    expect(cupom?.itens).toHaveLength(3);
    expect(repo.statusDoCupom(cupomId)).toBe('processado');
  });

  it('não vaza cupom de outro dono (→ 404 na HTTP)', async () => {
    const repo = new RepositorioMemoria();
    const servico = servicoComProcessador(repo);
    const { cupomId } = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });

    expect(await servico.ingerirHtml('outro-user', cupomId, HTML_RJ)).toBeUndefined();
    // Cupom do dono legítimo segue intacto.
    expect(repo.statusDoCupom(cupomId)).toBe('qr_capturado');
  });

  it('HTML ainda de desafio: lança HtmlDesafioError e NÃO marca falha', async () => {
    const repo = new RepositorioMemoria();
    const servico = servicoComProcessador(repo);
    const { cupomId } = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });

    const desafio = '<html><body><script>grecaptcha.execute(k,{action:"x"})</script></body></html>';
    await expect(servico.ingerirHtml('user-1', cupomId, desafio)).rejects.toThrow(HtmlDesafioError);
    // Recuperável: continua aguardando, não vira `falha` permanente.
    expect(repo.statusDoCupom(cupomId)).toBe('qr_capturado');
  });

  it('sem processador configurado, a ingestão por HTML é indisponível', async () => {
    const servico = new ServicoIngestao(new RepositorioMemoria(), filaFake());
    await expect(servico.ingerirHtml('user-1', 'x', HTML_RJ)).rejects.toThrow(/processador/i);
  });
});
