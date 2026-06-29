/**
 * C11.5 — Serviço de enriquecimento de produto (curadoria).
 *
 * Recebe um pedido de curadoria e aplica os campos de exibição ao produto
 * canônico. Valida que há um alvo (id OU EAN) e ao menos um campo a mudar —
 * fora isso, a regra de "não tocar no casamento" mora na porta de persistência.
 */

import type { EnriquecimentoProdutoRequest, EnriquecimentoProdutoResponse } from '@barganha/shared';

import { LancamentoInvalidoError } from '../erros';
import type { RepositorioCuradoria } from './tipos';

export class ServicoCuradoria {
  constructor(private readonly repo: RepositorioCuradoria) {}

  /**
   * Aplica o enriquecimento. `undefined` = produto-alvo inexistente (HTTP 404).
   * Lança `LancamentoInvalidoError` (HTTP 400) se faltar alvo ou campo.
   */
  async enriquecer(
    req: EnriquecimentoProdutoRequest,
  ): Promise<EnriquecimentoProdutoResponse | undefined> {
    if (!req.produtoCanonicoId && !req.ean) {
      throw new LancamentoInvalidoError('Informe produtoCanonicoId ou ean para enriquecer.');
    }
    const temCampo =
      req.nomeExibicao != null ||
      req.marca != null ||
      req.categoria != null ||
      req.imagemUrl != null;
    if (!temCampo) {
      throw new LancamentoInvalidoError('Nada para enriquecer: informe ao menos um campo.');
    }

    const produtoCanonicoId = await this.repo.enriquecerProduto({
      ...(req.produtoCanonicoId ? { produtoCanonicoId: req.produtoCanonicoId } : {}),
      ...(req.ean ? { ean: req.ean } : {}),
      ...(req.nomeExibicao != null ? { nomeExibicao: req.nomeExibicao } : {}),
      ...(req.marca != null ? { marca: req.marca } : {}),
      ...(req.categoria != null ? { categoria: req.categoria } : {}),
      ...(req.imagemUrl != null ? { imagemUrl: req.imagemUrl } : {}),
    });
    if (!produtoCanonicoId) return undefined;
    return { produtoCanonicoId };
  }
}
