/**
 * C12.5 — Portas de persistência da DENÚNCIA de preço.
 *
 * O registro é PRIVADO (carrega `usuarioId` para anti-abuso) e vive separado do
 * pool. Ao contrário do lançamento manual (C11.3), a denúncia NÃO tem caminho de
 * publicação: não existe método que escreva em `observacao_preco`. Ela é sinal
 * de curadoria — o alvo é `produtoCanonicoId` + geo, nunca uma observação.
 *
 * A visão de curadoria (`DenunciaCuradoria`, em shared) NÃO expõe `usuarioId`:
 * o curador decide pelo conteúdo (produto/motivo/volume), não por quem reportou.
 */

import type { DenunciaCuradoria, MotivoDenuncia } from '@barganha/shared';

/** Nova denúncia a registrar (lado PRIVADO — tem o autor). */
export interface DenunciaNova {
  usuarioId: string;
  produtoCanonicoId: string;
  motivo: MotivoDenuncia;
  municipio?: string;
  uf?: string;
  comentario?: string;
}

/** Resultado do registro: id e se já existia uma denúncia aberta desta pessoa. */
export interface DenunciaRegistrada {
  id: string;
  jaRegistrada: boolean;
}

/**
 * Os nomes carregam o sufixo `Denuncia` de propósito: o `RepositorioSupabase`
 * implementa esta porta E a de moderação (C11.3), que já tem `criar`,
 * `listarPendentes` e `decidir`. Nomes distintos evitam sobrecarga na classe
 * concreta — que confundiria as duas fichas de dados privadas.
 */
export interface RepositorioDenuncia {
  /**
   * Existe `produto_canonico` com este id? Serve para recusar denúncia órfã com
   * 400 em vez de deixar a FK estourar como 500. Fica nesta porta (e não em
   * `CatalogoProdutos`) para não inflar uma interface alheia por um único uso.
   */
  existeProduto(produtoCanonicoId: string): Promise<boolean>;
  /**
   * Registra a denúncia como `pendente`. Idempotente por (usuário, produto)
   * enquanto houver uma aberta — o índice único parcial garante isso no banco;
   * aqui devolvemos `jaRegistrada: true` em vez de erro, porque para quem usa o
   * app denunciar duas vezes não é falha, é redundância.
   */
  criarDenuncia(dados: DenunciaNova): Promise<DenunciaRegistrada>;
  /** Fila de curadoria: pendentes, mais antigas primeiro. Sem `usuarioId`. */
  listarDenunciasPendentes(limite?: number): Promise<DenunciaCuradoria[]>;
  /** Fecha a denúncia (`aprovado` = procedente, `rejeitado` = improcedente). */
  decidirDenuncia(id: string, procedente: boolean, resolucao?: string): Promise<boolean>;
}
