/**
 * C2.1 — Serviço de ingestão de QR.
 *
 * Recebe só o conteúdo cru do QR (parsing roda no backend, nunca no app) e:
 *  1. valida/extrai a chave e a UF (sem tocar a SEFAZ);
 *  2. grava o cupom como `qr_capturado` de forma IDEMPOTENTE por chave — o QR
 *     cru é guardado de QUALQUER estado desde o dia 1 (docs/03);
 *  3. enfileira o processamento assíncrono (a resposta não espera o parsing).
 *
 * A UF sem parser NÃO é erro aqui: o cupom fica guardado para reprocessamento
 * retroativo (C2.5). Erros só acontecem se o QR/chave forem inválidos.
 */

import type { IngestaoQrRequest, IngestaoQrResponse } from '@barganha/shared';

import type { FilaProcessamento } from '../fila/tipos';
import { parseQrNfce } from '../parsers/qr-payload';
import type { RepositorioCupom } from '../persistencia/tipos';

export class ServicoIngestao {
  constructor(
    private readonly repo: RepositorioCupom,
    private readonly fila: FilaProcessamento,
  ) {}

  async ingerir(usuarioId: string, req: IngestaoQrRequest): Promise<IngestaoQrResponse> {
    const qr = parseQrNfce(req.qrPayload);

    const resultado = await this.repo.criarOuObterPorChave({
      usuarioId,
      chaveAcesso: qr.chave.valor,
      uf: qr.uf,
      qrPayload: qr.payloadCru,
      capturadoEm: req.capturadoEm,
    });

    // Enfileira no primeiro envio ou quando um envio anterior falhou (retry do
    // cliente). Cupons já `processado`/`qr_capturado` em andamento não são
    // re-enfileirados — evita reprocessar e duplicar no pool.
    if (resultado.novo || resultado.status === 'falha') {
      await this.fila.enfileirar({ cupomId: resultado.cupomId });
    }

    return { cupomId: resultado.cupomId, status: resultado.status };
  }
}
