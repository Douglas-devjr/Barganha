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

import type { CupomResponse, IngestaoQrRequest, IngestaoQrResponse } from '@barganha/shared';

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
      await this.fila.enfileirar({ cupomId: resultado.cupomId, uf: qr.uf });
    }

    return { cupomId: resultado.cupomId, status: resultado.status };
  }

  /**
   * C6.3 — Estado de um cupom do PRÓPRIO usuário (privado). O app consulta para
   * acompanhar o parsing assíncrono e exibir os itens. `undefined` quando o
   * cupom não existe ou é de outro dono — a camada HTTP traduz para 404.
   */
  async obterCupom(usuarioId: string, cupomId: string): Promise<CupomResponse | undefined> {
    const cupom = await this.repo.obterDoUsuario(cupomId, usuarioId);
    if (!cupom) return undefined;
    return {
      cupomId: cupom.cupomId,
      status: cupom.status,
      ...(cupom.emitidoEm ? { emitidoEm: cupom.emitidoEm } : {}),
      ...(cupom.uf ? { uf: cupom.uf } : {}),
      ...(cupom.loja ? { loja: cupom.loja } : {}),
      itens: cupom.itens.map((i) => ({
        ...(i.produtoCanonicoId ? { produtoCanonicoId: i.produtoCanonicoId } : {}),
        descricaoOriginal: i.descricaoOriginal,
        ...(i.ean ? { ean: i.ean } : {}),
        quantidade: i.quantidade,
        unidade: i.unidade,
        valorUnitario: i.valorUnitario,
        valorTotal: i.valorTotal,
        ...(i.desconto != null ? { desconto: i.desconto } : {}),
      })),
    };
  }
}
