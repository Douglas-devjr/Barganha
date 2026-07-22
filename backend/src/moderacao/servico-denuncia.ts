/**
 * C12.5 — Serviço de denúncia de preço.
 *
 * Dois lados, como em C11.3:
 *  • USUÁRIO: `denunciar` registra o sinal como `pendente`. Valida que o motivo
 *    é conhecido e que o produto existe — não enfileiramos denúncia órfã.
 *  • CURADORIA: `listarFila` mostra as pendentes (ordenadas por volume no mesmo
 *    produto, que é o sinal forte); `decidir` fecha como procedente ou não.
 *
 * O que este serviço NÃO faz, de propósito: escrever no pool. Não há método de
 * publicação e o repositório de denúncia não expõe nenhum. Denunciar é sinal
 * para a curadoria agir com as ferramentas que já existem (casamento, unidade,
 * alias) — o gate de anonimização continua sendo o único caminho de escrita em
 * `observacao_preco` (decisão travada #3, docs/04).
 *
 * O `usuarioId` entra em `denunciar` (anti-abuso) e nunca sai: a fila devolve
 * `DenunciaCuradoria`, que não tem o campo.
 */

import {
  type DenunciaCuradoria,
  type DenunciaPrecoRequest,
  type DenunciaPrecoResponse,
  MOTIVOS_DENUNCIA,
} from '@barganha/shared';

import { LancamentoInvalidoError } from '../erros';

import type { RepositorioDenuncia } from './tipos-denuncia';

const LIMITE_FILA_PADRAO = 50;
/** Teto do texto livre — evita que "outro" vire campo de despejo. */
const MAX_COMENTARIO = 500;

export class ServicoDenuncia {
  constructor(private readonly repo: RepositorioDenuncia) {}

  /** Registra a denúncia como `pendente` (lado privado). */
  async denunciar(usuarioId: string, req: DenunciaPrecoRequest): Promise<DenunciaPrecoResponse> {
    if (!MOTIVOS_DENUNCIA.includes(req.motivo)) {
      throw new LancamentoInvalidoError(`Motivo "${req.motivo}" não reconhecido.`);
    }

    // Denúncia órfã não ajuda a curadoria: sem produto, não há o que revisar.
    if (!(await this.repo.existeProduto(req.produtoCanonicoId))) {
      throw new LancamentoInvalidoError('Produto não encontrado.');
    }

    const comentario = req.comentario?.trim().slice(0, MAX_COMENTARIO);

    const { id, jaRegistrada } = await this.repo.criarDenuncia({
      usuarioId,
      produtoCanonicoId: req.produtoCanonicoId,
      motivo: req.motivo,
      ...(req.municipio ? { municipio: req.municipio } : {}),
      ...(req.uf ? { uf: req.uf } : {}),
      ...(comentario ? { comentario } : {}),
    });

    return { id, status: 'pendente', jaRegistrada };
  }

  /** Fila de curadoria (sem `usuarioId` — decisão é pelo conteúdo). */
  listarFila(limite = LIMITE_FILA_PADRAO): Promise<DenunciaCuradoria[]> {
    return this.repo.listarDenunciasPendentes(limite);
  }

  /**
   * Fecha a denúncia. `false` = id inexistente ou já decidido (HTTP 404).
   * "Procedente" só marca o sinal como válido; a correção do dado é feita pelas
   * rotas de curadoria que já existem — aqui não se toca no pool.
   */
  decidir(id: string, procedente: boolean, resolucao?: string): Promise<boolean> {
    return this.repo.decidirDenuncia(id, procedente, resolucao);
  }
}
