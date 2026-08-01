/**
 * Rotas de ALERTA DE PREÇO + DISPOSITIVO DE PUSH — PRIVADAS (exigem conta).
 *
 * C8.4 — espelho no servidor do alerta local, para permitir push com o app
 * fechado. `usuario_id`/token nunca cruzam para o pool anônimo (docs/04).
 *
 *  • `PUT /alertas` — substitui TODO o conjunto de alertas do usuário (sem
 *    drift entre o SQLite do aparelho e o servidor).
 *  • `DELETE /alertas` — apaga todos os alertas do usuário (sem body).
 *  • `POST /dispositivos/push` — registra o token Expo do aparelho (após a
 *    pessoa aceitar a permissão de notificação).
 *  • `DELETE /dispositivos/push` — remove o token (logout, permissão revogada).
 *
 * Reaproveita o teto por conta da ingestão via `guardaPrivadoIp` (anti-spam),
 * como as demais rotas de contribuição.
 */

import type {
  RegistrarDispositivoPushRequest,
  RemoverDispositivoPushRequest,
  SincronizarAlertasRequest,
} from '@barganha/shared';
import type { FastifyInstance } from 'fastify';

import type { ContextoRotas } from '../contexto';
import {
  SCHEMA_REGISTRAR_DISPOSITIVO,
  SCHEMA_REMOVER_DISPOSITIVO,
  SCHEMA_SINCRONIZAR_ALERTAS,
} from '../esquemas';

export function registrarRotasAlertas(app: FastifyInstance, ctx: ContextoRotas): void {
  const { servicoAlertas } = ctx.deps;
  if (!servicoAlertas) return;

  app.put<{ Body: SincronizarAlertasRequest }>(
    '/alertas',
    { schema: SCHEMA_SINCRONIZAR_ALERTAS, onRequest: ctx.guardaPrivadoIp },
    async (req, reply) => {
      const usuarioId = await ctx.contaDoRequest(req, reply);
      if (!usuarioId) return reply;
      const resposta = await servicoAlertas.sincronizar(usuarioId, req.body.alertas);
      return reply.code(200).send(resposta);
    },
  );

  app.delete('/alertas', { onRequest: ctx.guardaPrivadoIp }, async (req, reply) => {
    const usuarioId = await ctx.contaDoRequest(req, reply);
    if (!usuarioId) return reply;
    await servicoAlertas.apagarTodos(usuarioId);
    return reply.code(204).send();
  });

  app.post<{ Body: RegistrarDispositivoPushRequest }>(
    '/dispositivos/push',
    { schema: SCHEMA_REGISTRAR_DISPOSITIVO, onRequest: ctx.guardaPrivadoIp },
    async (req, reply) => {
      const usuarioId = await ctx.contaDoRequest(req, reply);
      if (!usuarioId) return reply;
      await servicoAlertas.registrarDispositivo(usuarioId, req.body.token, req.body.plataforma);
      return reply.code(204).send();
    },
  );

  app.delete<{ Body: RemoverDispositivoPushRequest }>(
    '/dispositivos/push',
    { schema: SCHEMA_REMOVER_DISPOSITIVO, onRequest: ctx.guardaPrivadoIp },
    async (req, reply) => {
      const usuarioId = await ctx.contaDoRequest(req, reply);
      if (!usuarioId) return reply;
      await servicoAlertas.removerDispositivo(req.body.token);
      return reply.code(204).send();
    },
  );
}
