import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { Anonimizador } from '../anonimizacao/anonimizador';
import { FalhaBuscaSefazError } from '../erros';
import { PipelineEstatistica } from '../estatistica/pipeline';
import { FilaMemoria } from '../fila/fila-memoria';
import { TelemetriaMemoria } from '../observabilidade/telemetria-memoria';
import type { ClienteSefaz, ParserSefaz } from '../parsers/tipos';
import type { QrNfce } from '../parsers/qr-payload';
import { RegistroParsers } from '../parsers/registro';
import { ParserRj } from '../parsers/rj';
import { ParserSp } from '../parsers/sp';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { ControleRollout } from '../rollout/controle-rollout';
import { ProcessadorCupom } from './processador-cupom';
import { ReprocessadorRetroativo } from './reprocessamento';

const fix = (nome: string): string =>
  readFileSync(fileURLToPath(new URL(`../parsers/__fixtures__/${nome}`, import.meta.url)), 'utf8');
const HTML_RJ = fix('rj-nota-1.html');
const HTML_SP = fix('sp-nota-1.html');

const QR_RJ =
  'https://www.fazenda.rj.gov.br/nfce/qrcode?p=33260612345678000199650010000000011000000016|2|1';
const QR_SP =
  'https://www.nfce.fazenda.sp.gov.br/qrcode?p=35260661585865000151650010000000011000000012|2|1';
const CAPTURA = { capturadoEm: '2026-06-27T12:00:00.000Z' };
const semEspera = (): Promise<void> => Promise.resolve();

/** Monta a engrenagem completa de C2 com adaptadores em memória. */
function montar(criarParsers: (cliente: ClienteSefaz) => ParserSefaz[], cliente: ClienteSefaz) {
  const repo = new RepositorioMemoria();
  const registro = new RegistroParsers(criarParsers(cliente));
  const anonimizador = new Anonimizador(repo);
  const processador = new ProcessadorCupom(repo, registro, anonimizador);
  const fila = new FilaMemoria((t) => processador.processar(t.cupomId), { dormir: semEspera });
  const servico = new ServicoIngestao(repo, fila);
  const reprocessador = new ReprocessadorRetroativo(repo, registro, fila);
  return { repo, registro, fila, servico, reprocessador };
}

const clienteRjSp = new (class implements ClienteSefaz {
  buscarConsulta(qr: QrNfce): Promise<string> {
    return Promise.resolve(qr.uf === 'RJ' ? HTML_RJ : HTML_SP);
  }
})();

describe('Fluxo de captura C2 (ingestão → parse → anonimização → pool)', () => {
  it('processa um cupom do RJ ponta a ponta (FV)', async () => {
    const { repo, servico, fila } = montar((c) => [new ParserRj(c), new ParserSp(c)], clienteRjSp);

    const res = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });
    expect(res.status).toBe('qr_capturado');
    await fila.ociosa();

    expect(repo.statusDoCupom(res.cupomId)).toBe('processado');
    // Lado privado: os 3 itens da nota do RJ.
    expect(repo.itensDoCupom(res.cupomId)).toHaveLength(3);
    // Lado compartilhado: os 3 itens — 2 por EAN e a banana pela descrição.
    const pool = repo.observacoesDoPool();
    expect(pool).toHaveLength(3);
    expect(pool[0]).toMatchObject({ lojaCnpj: '12345678000199', uf: 'RJ' });
  });

  it('recalcula a estatística no processamento (o veredito na gôndola ganha dados)', async () => {
    // Espelha o composition root: liga o gatilho de recálculo ao pipeline. Sem
    // ele, o pool enche mas `preco_estatistica` fica vazio e a consulta dá 404.
    const repo = new RepositorioMemoria();
    const registro = new RegistroParsers([new ParserRj(clienteRjSp), new ParserSp(clienteRjSp)]);
    const anonimizador = new Anonimizador(repo);
    const pipeline = new PipelineEstatistica(repo, repo);
    const processador = new ProcessadorCupom(repo, registro, anonimizador, {
      aoPublicarPool: async (ids) => {
        for (const id of ids) await pipeline.recalcularProduto(id);
      },
    });
    const fila = new FilaMemoria((t) => processador.processar(t.cupomId), { dormir: semEspera });
    const servico = new ServicoIngestao(repo, fila);

    const res = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });
    await fila.ociosa();

    expect(repo.statusDoCupom(res.cupomId)).toBe('processado');
    // Sem chamada manual do pipeline: a média já foi construída no processamento.
    const produtoId = repo.observacoesDoPool()[0]!.produtoCanonicoId;
    const estat = repo.estatisticasDoProduto(produtoId);
    expect(estat.length).toBeGreaterThan(0);
    const naLoja = estat.find((e) => e.escopo === 'loja');
    expect(naLoja?.nObservacoes).toBe(1);
    expect(naLoja?.mediana).toBeGreaterThan(0);
  });

  it('processa SP com o mesmo serviço (parser resolvido por UF)', async () => {
    const { repo, servico, fila } = montar((c) => [new ParserRj(c), new ParserSp(c)], clienteRjSp);
    const res = await servico.ingerir('user-1', { qrPayload: QR_SP, ...CAPTURA });
    await fila.ociosa();
    expect(repo.statusDoCupom(res.cupomId)).toBe('processado');
    expect(repo.observacoesDoPool().every((o) => o.uf === 'SP')).toBe(true);
  });

  it('é idempotente: reenviar o mesmo QR não duplica no pool', async () => {
    const { repo, servico, fila } = montar((c) => [new ParserRj(c), new ParserSp(c)], clienteRjSp);

    const r1 = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });
    await fila.ociosa();
    const r2 = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });
    await fila.ociosa();

    expect(r2.cupomId).toBe(r1.cupomId);
    expect(r2.status).toBe('processado');
    expect(repo.observacoesDoPool()).toHaveLength(3);
  });

  it('guarda QR de UF sem parser e reprocessa quando o parser entra (C2.5)', async () => {
    // Só SP tem parser; o QR é do RJ → fica qr_capturado, sem ir ao pool.
    const cliente = clienteRjSp;
    const repo = new RepositorioMemoria();
    const anonimizador = new Anonimizador(repo);

    const registroSoSp = new RegistroParsers([new ParserSp(cliente)]);
    const procSoSp = new ProcessadorCupom(repo, registroSoSp, anonimizador);
    const filaSoSp = new FilaMemoria((t) => procSoSp.processar(t.cupomId), { dormir: semEspera });
    const servico = new ServicoIngestao(repo, filaSoSp);

    const res = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });
    await filaSoSp.ociosa();
    expect(repo.statusDoCupom(res.cupomId)).toBe('qr_capturado');
    expect(repo.observacoesDoPool()).toHaveLength(0);

    // Parser do RJ entra no ar → reprocessamento retroativo.
    const registroComRj = new RegistroParsers([new ParserSp(cliente), new ParserRj(cliente)]);
    const procComRj = new ProcessadorCupom(repo, registroComRj, anonimizador);
    const filaComRj = new FilaMemoria((t) => procComRj.processar(t.cupomId), { dormir: semEspera });
    const reproc = new ReprocessadorRetroativo(repo, registroComRj, filaComRj);

    const n = await reproc.reprocessarUf('RJ');
    await filaComRj.ociosa();

    expect(n).toBe(1);
    expect(repo.statusDoCupom(res.cupomId)).toBe('processado');
    expect(repo.observacoesDoPool()).toHaveLength(3);
  });

  it('represa UF com parser mas fora do rollout e a libera ao habilitá-la (C10.3)', async () => {
    // RJ e SP têm parser, mas o rollout só habilitou SP.
    const repo = new RepositorioMemoria();
    const registro = new RegistroParsers([new ParserRj(clienteRjSp), new ParserSp(clienteRjSp)]);
    const anonimizador = new Anonimizador(repo);
    const telemetria = new TelemetriaMemoria();

    const procSoSp = new ProcessadorCupom(repo, registro, anonimizador, {
      rollout: new ControleRollout(['SP']),
      telemetria,
    });
    const filaSoSp = new FilaMemoria((t) => procSoSp.processar(t.cupomId), { dormir: semEspera });
    const servico = new ServicoIngestao(repo, filaSoSp);

    const res = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });
    await filaSoSp.ociosa();

    // Fica represado (qr_capturado), nada vai ao pool, e a telemetria conta o motivo.
    expect(repo.statusDoCupom(res.cupomId)).toBe('qr_capturado');
    expect(repo.observacoesDoPool()).toHaveLength(0);
    expect(telemetria.snapshot().porUf.RJ?.uf_nao_habilitada).toBe(1);

    // RJ entra no rollout → reprocessamento retroativo (C2.5) libera os represados.
    const procComRj = new ProcessadorCupom(repo, registro, anonimizador, {
      rollout: new ControleRollout(['SP', 'RJ']),
      telemetria,
    });
    const filaComRj = new FilaMemoria((t) => procComRj.processar(t.cupomId), { dormir: semEspera });
    const reproc = new ReprocessadorRetroativo(repo, registro, filaComRj);

    const n = await reproc.reprocessarUf('RJ');
    await filaComRj.ociosa();

    expect(n).toBe(1);
    expect(repo.statusDoCupom(res.cupomId)).toBe('processado');
    expect(repo.observacoesDoPool()).toHaveLength(3);
    expect(telemetria.snapshot().porUf.RJ?.processado).toBe(1);
  });

  it('marca falha em erro permanente de parsing (sem retry)', async () => {
    const clienteQuebrado = new (class implements ClienteSefaz {
      buscarConsulta(): Promise<string> {
        return Promise.resolve('<html><body>sem nota</body></html>');
      }
    })();
    const { repo, servico, fila } = montar((c) => [new ParserRj(c)], clienteQuebrado);

    const res = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });
    await fila.ociosa();

    expect(repo.statusDoCupom(res.cupomId)).toBe('falha');
    expect(repo.observacoesDoPool()).toHaveLength(0);
  });

  it('dá retry em erro transitório da SEFAZ e conclui', async () => {
    let tentativas = 0;
    const clienteInstavel = new (class implements ClienteSefaz {
      buscarConsulta(qr: QrNfce): Promise<string> {
        tentativas++;
        if (tentativas < 3) return Promise.reject(new FalhaBuscaSefazError('portal fora do ar'));
        return Promise.resolve(qr.uf === 'RJ' ? HTML_RJ : HTML_SP);
      }
    })();
    const { repo, servico, fila } = montar((c) => [new ParserRj(c)], clienteInstavel);

    const res = await servico.ingerir('user-1', { qrPayload: QR_RJ, ...CAPTURA });
    await fila.ociosa();

    expect(tentativas).toBe(3);
    expect(repo.statusDoCupom(res.cupomId)).toBe('processado');
  });
});
