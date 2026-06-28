/**
 * C4.3 — Porta de persistência da conta (lado PRIVADO).
 *
 * Conta mínima por design (sem nome/CPF — minimização LGPD, docs/04): só existe
 * para amarrar o histórico privado (`cupom`) a um dono e para o gate de acesso
 * da autenticação mínima. Nada disto toca o pool compartilhado.
 */

export interface RepositorioUsuario {
  /** Cria uma conta anônima e devolve seu id (a credencial Bearer, v1). */
  criarAnonimo(): Promise<string>;
  /** `true` se a conta existe — gate de acesso da auth mínima (C4.3). */
  existe(id: string): Promise<boolean>;
}
