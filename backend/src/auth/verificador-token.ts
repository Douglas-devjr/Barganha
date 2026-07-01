/**
 * C4.3.1 — Verificação de token de autenticação (login real, Supabase Auth).
 *
 * Porta única onde o backend troca um access token (JWT do Supabase) pelo id do
 * usuário (`auth.users.id`). Substitui o "UUID-como-Bearer" da conta anônima —
 * exatamente o ponto que docs/01 antecipa: "evoluir para JWT/Supabase Auth é
 * trocar só esta peça".
 *
 * LGPD (docs/04): o token identifica o usuário SÓ do lado PRIVADO (ingestão do
 * histórico). O pool compartilhado (`observacao_preco`) segue anônimo — nada
 * aqui o toca, e o `sub` do token nunca cruza para uma observação de preço.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface VerificadorToken {
  /**
   * Valida o access token e devolve o id do usuário (`auth.users.id`), ou
   * `undefined` se for inválido/expirado. Nunca lança por token ruim — credencial
   * inválida é um caminho esperado (a camada HTTP responde 401).
   */
  verificar(token: string): Promise<string | undefined>;
}

/**
 * Valida o JWT contra o GoTrue do Supabase (`auth.getUser`). Robusto a qualquer
 * algoritmo de assinatura (HS256 legado ou chaves assimétricas novas) e ciente
 * de revogação — ao custo de uma chamada à Auth API por request privado. Aceitável:
 * a ingestão é assíncrona (202 + fila) e de baixa frequência (um scan por compra).
 */
export class VerificadorTokenSupabase implements VerificadorToken {
  constructor(private readonly db: SupabaseClient) {}

  async verificar(token: string): Promise<string | undefined> {
    try {
      const { data, error } = await this.db.auth.getUser(token);
      if (error || !data.user) return undefined;
      return data.user.id;
    } catch {
      // Falha de rede / Auth API fora → trata como não autenticado (401), não 500.
      return undefined;
    }
  }
}
