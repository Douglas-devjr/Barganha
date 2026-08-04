/**
 * C11.5 — Serviço de enriquecimento de produto (curadoria).
 *
 * Recebe um pedido de curadoria e aplica os campos de exibição ao produto
 * canônico. Valida que há um alvo (id OU EAN) e ao menos um campo a mudar —
 * fora isso, a regra de "não tocar no casamento" mora na porta de persistência.
 */

import type { EnriquecimentoProdutoRequest, EnriquecimentoProdutoResponse } from '@barganha/shared';

import { LancamentoInvalidoError } from '../erros';
import type { PaginaProdutosBusca, RepositorioCuradoria } from './tipos';

/** Tamanho de página quando o curador não pede um número. */
export const TAMANHO_PAGINA_BUSCA_PADRAO = 20;
/** Teto de servidor — pedido maior é cortado, não recusado (espelha C4.4). */
export const TAMANHO_PAGINA_BUSCA_MAX = 100;

/** Resposta paginada da busca de curadoria, já com a página efetivamente aplicada. */
export interface ResultadoBuscaCuradoria extends PaginaProdutosBusca {
  pagina: number;
  tamanhoPagina: number;
}

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

  /**
   * Busca produtos por nome ou EAN, paginada (C11.5) — a lacuna do painel de
   * curadoria antes da edição: sem isto, o curador precisava já saber o
   * `produtoCanonicoId` de cor para corrigir metadado.
   *
   * `pagina` é 1-based e nunca cai abaixo de 1; `tamanhoPagina` tem um padrão
   * sensato e um teto de servidor — pedido fora da faixa é CORRIGIDO, não
   * rejeitado (o curador não precisa acertar o número exato).
   */
  async buscar(
    termo: string,
    pagina?: number,
    tamanhoPagina?: number,
  ): Promise<ResultadoBuscaCuradoria> {
    const termoLimpo = termo?.trim();
    if (!termoLimpo) {
      throw new LancamentoInvalidoError('Informe um termo de busca (nome ou EAN).');
    }
    const paginaValida = Math.max(Math.trunc(pagina ?? 1), 1);
    const tamanhoValido = Math.min(
      Math.max(Math.trunc(tamanhoPagina ?? TAMANHO_PAGINA_BUSCA_PADRAO), 1),
      TAMANHO_PAGINA_BUSCA_MAX,
    );
    const { itens, total } = await this.repo.buscarProdutos(termoLimpo, paginaValida, tamanhoValido);
    return { itens, total, pagina: paginaValida, tamanhoPagina: tamanhoValido };
  }
}
