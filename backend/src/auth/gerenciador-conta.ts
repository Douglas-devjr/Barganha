/**
 * C4.3.1 — Gerência administrativa da conta (Supabase Auth).
 *
 * Hoje expõe só o APAGAMENTO da conta — o "direito ao apagamento" da LGPD
 * (docs/04). Apagar `auth.users` cascateia (FK on delete cascade, ver migração
 * de auth) para `usuario → cupom → item_cupom`: todo o lado PRIVADO some.
 *
 * O pool compartilhado (`observacao_preco`) NÃO é tocado: as observações já são
 * anônimas e soltas (sem `usuario_id`, sem `chave_acesso`), não são "do usuário"
 * nem reidentificáveis — não há o que apagar lá (docs/04).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface GerenciadorConta {
  /** Apaga a conta e, em cascata, todo o histórico privado do usuário. */
  apagar(usuarioId: string): Promise<void>;
}

export class GerenciadorContaSupabase implements GerenciadorConta {
  constructor(private readonly db: SupabaseClient) {}

  async apagar(usuarioId: string): Promise<void> {
    const { error } = await this.db.auth.admin.deleteUser(usuarioId);
    if (error) throw new Error(`Falha ao apagar a conta: ${error.message}`);
  }
}
