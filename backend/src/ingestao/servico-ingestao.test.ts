import { describe, expect, it, vi } from 'vitest';

import { ChaveAcessoInvalidaError, PayloadQrInvalidoError } from '../erros';
import type { FilaProcessamento } from '../fila/tipos';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoIngestao } from './servico-ingestao';

const QR_RJ =
  'https://www.fazenda.rj.gov.br/nfce/qrcode?p=33260612345678000199650010000000011000000016|2|1';
const CAPTURA = { capturadoEm: '2026-06-27T12:00:00.000Z' };

function filaFake(): FilaProcessamento {
  return { enfileirar: vi.fn().mockResolvedValue(undefined) };
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
