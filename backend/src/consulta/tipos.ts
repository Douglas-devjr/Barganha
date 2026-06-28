/**
 * C4.1 — Porta de resolução de produto na CONSULTA.
 *
 * Diferente do `casarPorEan` da ingestão (que acha-OU-CRIA o canônico), aqui
 * tudo é READ-ONLY: a consulta na gôndola jamais cria produto. Dois caminhos,
 * espelhando a tela Verificar (docs/06): EAN (principal) e nome (fallback).
 *
 * Opera só sobre o lado COMPARTILHADO (produto_canonico + preco_estatistica).
 */

import type { CandidatoCanonico } from '../estatistica/casamento-texto';

export interface FonteProdutoConsulta {
  /** Lookup direto por EAN; `undefined` se o produto ainda não existe na base. */
  obterProdutoPorEan(ean: string): Promise<string | undefined>;
  /**
   * Candidatos por nome para o ranqueamento por similaridade (C3.5). O serviço
   * escolhe o melhor; o repositório só pré-filtra (reduz o conjunto a pontuar).
   */
  candidatosPorNome(nome: string): Promise<CandidatoCanonico[]>;
}
