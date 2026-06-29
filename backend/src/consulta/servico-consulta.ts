/**
 * C4.1 — Serviço de consulta de estatística (com fallback geográfico).
 *
 * O momento de valor na gôndola: dado um produto (EAN ou nome) e o recorte geo
 * do usuário, devolve a faixa típica no nível MAIS ESPECÍFICO com base suficiente
 * (loja → município → região → UF), reusando o `resolverFallback` de C3.3.
 *
 * Só lê o pool COMPARTILHADO anônimo — nenhuma conta é necessária (docs/04).
 * `undefined` = produto não encontrado ou sem estatística no escopo (HTTP 404).
 *
 * Obs.: o contrato `ConsultaPrecoRequest` (C1.3) carrega município/UF, não o CNPJ
 * da loja; logo o fallback resolve a partir de município. O `LocalGeo` já aceita
 * `lojaCnpj`, então habilitar o nível loja é só passar a chave no futuro.
 */

import type { ConsultaPrecoRequest, ConsultaPrecoResponse } from '@barganha/shared';

import { sugerirCasamento } from '../estatistica/casamento-texto';
import {
  type LocalGeo,
  MIN_OBSERVACOES_FALLBACK,
  resolverFallback,
  type ResolvedorRegiao,
} from '../estatistica/escopos';
import type { RepositorioEstatistica } from '../estatistica/tipos';
import type { FonteProdutoConsulta } from './tipos';

export interface OpcoesConsulta {
  /** Resolve a chave de região; por padrão pula o nível (sem dado na v1). */
  resolverRegiao?: ResolvedorRegiao;
  /** Mínimo de observações p/ um nível ser confiável (a calibrar; docs/06). */
  minObservacoes?: number;
}

export class ServicoConsulta {
  constructor(
    private readonly produtos: FonteProdutoConsulta,
    private readonly estatisticas: RepositorioEstatistica,
    private readonly opcoes: OpcoesConsulta = {},
  ) {}

  async consultar(req: ConsultaPrecoRequest): Promise<ConsultaPrecoResponse | undefined> {
    const produtoCanonicoId = await this.resolverProduto(req);
    if (!produtoCanonicoId) return undefined;

    const local: LocalGeo = {
      lojaCnpj: '',
      ...(req.municipio ? { municipio: req.municipio } : {}),
      ...(req.uf ? { uf: req.uf } : {}),
    };

    const candidatos = await this.estatisticas.candidatosFallback(produtoCanonicoId, local);
    const resultado = resolverFallback(
      candidatos,
      local,
      this.opcoes.resolverRegiao,
      this.opcoes.minObservacoes ?? MIN_OBSERVACOES_FALLBACK,
    );
    if (!resultado) return undefined;

    // Anexa os dados de exibição (C11.5) quando disponíveis — a UI mostra nome
    // amigável/categoria/foto; sem enriquecimento, ainda traz a unidade-base.
    const produto = await this.produtos.obterResumoProduto(produtoCanonicoId);

    return {
      produtoCanonicoId,
      escopoResolvido: resultado.escopoResolvido,
      estatistica: resultado.estatistica,
      ...(produto ? { produto } : {}),
    };
  }

  /** EAN é o caminho principal; nome cai no casamento por texto (melhor score). */
  private async resolverProduto(req: ConsultaPrecoRequest): Promise<string | undefined> {
    if (req.ean) return this.produtos.obterProdutoPorEan(req.ean);
    if (req.nome) {
      const candidatos = await this.produtos.candidatosPorNome(req.nome);
      const [melhor] = sugerirCasamento(req.nome, candidatos);
      return melhor?.produtoCanonicoId;
    }
    return undefined;
  }
}
