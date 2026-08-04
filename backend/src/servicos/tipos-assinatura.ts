/**
 * C13.2 — Porta de persistência do plano da conta.
 *
 * `assinatura` é PRIVADA (mesma categoria de `cupom`/`item_cupom`): nunca
 * cruza para `observacao_preco` nem influencia a mediana compartilhada
 * (docs/21, regras travadas #1 e #2 — nunca se cobra por alimentar o pool nem
 * pelo veredito honesto). Esta porta é só LEITURA: ainda não existe nenhum
 * escritor de `assinatura` no backend (chega em C13.3/C13.4), e a tabela não
 * tem política de RLS de escrita nem para o dono — só a service role escreve
 * (ver supabase/migrations/20260802090000_assinatura.sql).
 */

import type { Plano } from '@barganha/shared';

/**
 * Linha crua de `assinatura`, na forma que o serviço recebe para decidir.
 * Deliberadamente SEM `origem` (contribuição × pago): o serviço não usa e o
 * DTO não expõe — ler a coluna sem finalidade seria coletar à toa um dado que
 * revela como a pessoa paga (minimização, gate de privacidade). Volta a entrar
 * aqui só quando C13.3/C13.4 derem um uso real a ela.
 */
export interface LinhaAssinatura {
  plano: Plano;
  /** ISO 8601. Null = sem validade (gratis, ou plus vitalício). */
  validoAte: string | null;
}

export interface RepositorioAssinatura {
  /** `undefined` = sem linha em `assinatura` → o serviço decide o padrão `gratis`. */
  obterAssinatura(usuarioId: string): Promise<LinhaAssinatura | undefined>;
}
