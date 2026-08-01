/**
 * C8.4 — Portas de persistência do alerta de preço + dispositivo de push.
 *
 * `alerta_preco` e `dispositivo_push` são PRIVADOS (espelho no servidor do
 * alerta local, mesma categoria de `cupom`/`item_cupom`): nunca cruzam para
 * `observacao_preco` nem entram na mediana compartilhada (docs/04, decisão
 * travada #8). O job de push (`jobs/alerta-preco.ts`) só LÊ estas tabelas +
 * `preco_estatistica`; a escrita de disparo/rearme vive fora desta porta (o job
 * fala direto com o banco — ver o próprio job).
 */

import type { AlertaPrecoItem } from '@barganha/shared';

export interface RepositorioAlertas {
  /**
   * Substitui TODO o conjunto de alertas do usuário pelos itens enviados
   * (delete do que saiu + upsert do que ficou, numa transação — ver
   * `sincronizar_alertas` em supabase/migrations). Redefinir um alvo já
   * existente zera o dedupe de disparo (o alvo mudou; é alerta novo).
   */
  sincronizarAlertas(usuarioId: string, itens: readonly AlertaPrecoItem[]): Promise<void>;
  /** Remove todos os alertas do usuário (não toca `dispositivo_push`). */
  apagarAlertas(usuarioId: string): Promise<void>;
  /** Upsert do token de push do aparelho (mesmo token, mesmo dono → atualiza). */
  registrarDispositivoPush(
    usuarioId: string,
    token: string,
    plataforma: 'ios' | 'android',
  ): Promise<void>;
  /** Remove um token (token inválido, logout, `DeviceNotRegistered` do Expo). */
  removerDispositivoPush(token: string): Promise<void>;
}
