/**
 * C11.3 — Serviço de lançamento manual de gôndola + moderação.
 *
 * Dois lados:
 *  • USUÁRIO: `lancar` registra o preço de prateleira como `pendente`. Valida na
 *    porta de entrada que a unidade é normalizável e o CNPJ é válido — só guarda
 *    o que pode virar observação COMPARÁVEL (nunca valor cru).
 *  • CURADORIA: `listarFila` mostra os pendentes; `decidir` aprova ou rejeita.
 *    Aprovar normaliza o preço, casa o produto por EAN, passa pelo MESMO gate de
 *    anonimização do cupom (C1.4) e publica a observação no pool. Rejeitar não
 *    publica nada.
 *
 * O `usuarioId` do autor entra em `lancar` (anti-abuso, lado privado) e é
 * DESCARTADO na publicação — o gate nunca o copia para o pool (docs/04).
 */

import {
  type DecisaoModeracaoRequest,
  type DecisaoModeracaoResponse,
  extrairObservacoesAnonimas,
  type LancamentoManualRequest,
  type LancamentoManualResponse,
  type LancamentoModeracaoResponse,
  normalizarDescricao,
  normalizarPreco,
} from '@barganha/shared';

import type { CatalogoProdutos } from '../anonimizacao/casamento';
import { LancamentoInvalidoError } from '../erros';
import type { LancamentoModeracaoRegistro, RepositorioModeracao } from './tipos';

/** Tamanho máximo da fila devolvida à curadoria de uma vez. */
const LIMITE_FILA_PADRAO = 100;

export class ServicoModeracao {
  constructor(
    private readonly repo: RepositorioModeracao,
    private readonly catalogo: CatalogoProdutos,
  ) {}

  /** Registra um lançamento manual como `pendente` (lado privado). */
  async lancar(usuarioId: string, req: LancamentoManualRequest): Promise<LancamentoManualResponse> {
    // Só entra na fila o que pode virar observação comparável: unidade conhecida
    // e preço válido (mesmo mapa do cupom, shared/). Falha → 400, não enfileira.
    const norm = normalizarPreco({ unidade: req.unidade, valorUnitario: req.valorUnitario });
    if (!norm) {
      throw new LancamentoInvalidoError(
        `Unidade "${req.unidade}" não reconhecida ou preço inválido — não dá para comparar.`,
      );
    }

    const cnpj = req.lojaCnpj.replace(/\D/g, '');
    if (cnpj.length !== 14) {
      throw new LancamentoInvalidoError('CNPJ da loja inválido (esperado 14 dígitos).');
    }

    const id = await this.repo.criar({
      usuarioId,
      ean: req.ean.trim(),
      descricao: req.descricao.trim(),
      unidade: req.unidade,
      valorUnitario: req.valorUnitario,
      lojaCnpj: cnpj,
      ...(req.municipio ? { municipio: req.municipio } : {}),
      ...(req.uf ? { uf: req.uf } : {}),
      emPromocao: req.emPromocao ?? false,
    });

    return { lancamentoId: id, status: 'pendente' };
  }

  /** Fila de curadoria (sem `usuarioId` — decisão é pelo conteúdo). */
  async listarFila(limite = LIMITE_FILA_PADRAO): Promise<LancamentoModeracaoResponse[]> {
    const pendentes = await this.repo.listarPendentes(limite);
    return pendentes.map((l) => this.paraResposta(l));
  }

  /**
   * Decide um lançamento. `undefined` = id inexistente (HTTP 404). Idempotente:
   * decidir de novo um já-decidido devolve o status atual sem republicar.
   */
  async decidir(
    id: string,
    req: DecisaoModeracaoRequest,
  ): Promise<DecisaoModeracaoResponse | undefined> {
    const lancamento = await this.repo.obter(id);
    if (!lancamento) return undefined;
    if (lancamento.status !== 'pendente') {
      return { id, status: lancamento.status };
    }

    if (req.decisao === 'rejeitar') {
      await this.repo.rejeitar(id, req.motivo);
      return { id, status: 'rejeitado' };
    }

    // Aprovar: normaliza → casa por EAN → gate → publica no pool.
    const norm = normalizarPreco({
      unidade: lancamento.unidade,
      valorUnitario: lancamento.valorUnitario,
    });
    if (!norm) {
      // Não deveria ocorrer (validado no `lancar`); falha-segura: rejeita.
      await this.repo.rejeitar(id, 'Unidade deixou de ser normalizável.');
      return { id, status: 'rejeitado' };
    }

    const produtoCanonicoId = await this.catalogo.casarPorEan(lancamento.ean, {
      descricaoNormalizada: normalizarDescricao(lancamento.descricao),
      unidadeBase: norm.unidadeBase,
    });

    // MESMO gate do cupom (C1.4): o contexto privado entra de propósito — é onde
    // é descartado, não propagado. A saída é anônima por construção.
    const [observacao] = extrairObservacoesAnonimas({
      loja: {
        cnpj: lancamento.lojaCnpj,
        ...(lancamento.municipio ? { municipio: lancamento.municipio } : {}),
        ...(lancamento.uf ? { uf: lancamento.uf } : {}),
      },
      observadoEm: lancamento.criadoEm,
      itens: [
        {
          produtoCanonicoId,
          precoNormalizado: norm.precoNormalizado,
          unidadeBase: norm.unidadeBase,
          emPromocao: lancamento.emPromocao,
        },
      ],
      // Descartados pelo gate — nunca chegam ao pool (docs/04).
      usuarioId: 'curadoria',
      cupomId: id,
    });

    await this.repo.aprovar(
      id,
      {
        cnpj: lancamento.lojaCnpj,
        ...(lancamento.municipio ? { municipio: lancamento.municipio } : {}),
        ...(lancamento.uf ? { uf: lancamento.uf } : {}),
      },
      observacao!,
    );
    return { id, status: 'aprovado' };
  }

  private paraResposta(l: LancamentoModeracaoRegistro): LancamentoModeracaoResponse {
    return {
      id: l.id,
      ean: l.ean,
      descricao: l.descricao,
      unidade: l.unidade,
      valorUnitario: l.valorUnitario,
      lojaCnpj: l.lojaCnpj,
      ...(l.municipio ? { municipio: l.municipio } : {}),
      ...(l.uf ? { uf: l.uf } : {}),
      emPromocao: l.emPromocao,
      status: l.status,
      criadoEm: l.criadoEm,
    };
  }
}
