/**
 * C3.5 — Confirmação de casamento por texto (itens sem EAN).
 *
 * Depois que a curadoria confirma uma sugestão de casamento, grava um
 * `produto_alias` e dispara o job de republicação do pool para reprocessar
 * cupons com itens órfãos (mesma descrição normalizada).
 */

import type { ConfirmacaoCasamentoRequest, ConfirmacaoCasamentoResponse } from '@barganha/shared';

import { LancamentoInvalidoError } from '../erros';
import type { FonteCandidatosTexto } from '../estatistica/casamento-texto';

export class ServicoConfirmacaoCasamento {
  constructor(private readonly repo: FonteCandidatosTexto) {}

  async confirmar(req: ConfirmacaoCasamentoRequest): Promise<ConfirmacaoCasamentoResponse> {
    if (!req.produtoCanonicoId) {
      throw new LancamentoInvalidoError('produtoCanonicoId é obrigatório.');
    }
    if (req.confianca < 0 || req.confianca > 1) {
      throw new LancamentoInvalidoError('confianca deve estar entre 0 e 1.');
    }
    if (!req.textoOriginal || req.textoOriginal.trim().length === 0) {
      throw new LancamentoInvalidoError('textoOriginal é obrigatório.');
    }

    const aliasId = await this.repo.confirmarCasamento(
      req.produtoCanonicoId,
      req.confianca,
      req.textoOriginal,
    );

    return {
      aliasId,
      produtoCanonicoId: req.produtoCanonicoId,
      confirmado: true,
    };
  }
}
