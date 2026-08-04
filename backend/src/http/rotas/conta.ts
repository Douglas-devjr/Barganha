/**
 * Rotas de CONTA.
 *
 *  • `POST /conta/anonima` (C4.3) — afordância de teste/legado. Em produção o
 *    serviço não é injetado e a rota nem sobe: não há como obter conta sem
 *    autenticar.
 *  • `DELETE /conta` (C4.3.1) — direito ao apagamento (docs/04). Remove a conta
 *    de auth e, em cascata, todo o histórico privado. O pool anônimo não é
 *    tocado: as observações são soltas e sem vínculo com o usuário.
 *  • `GET /conta/estado` (C13.2) — estado do plano (`gratis`/`plus`). Sem
 *    escritor de produção ainda (C13.3/C13.4 escrevem em `assinatura`); esta
 *    rota só expõe o que já está no banco.
 */

import type { FastifyInstance } from 'fastify';

import type { ContextoRotas } from '../contexto';

export function registrarRotasConta(app: FastifyInstance, ctx: ContextoRotas): void {
  const { servicoConta, gerenciadorConta, servicoAssinatura } = ctx.deps;

  if (servicoConta) {
    app.post('/conta/anonima', { onRequest: ctx.guardaConta }, async (_req, reply) => {
      const resposta = await servicoConta.criarAnonima();
      return reply.code(201).send(resposta);
    });
  }

  if (gerenciadorConta) {
    // Rate-limit por conta (mesmo teto da ingestão): evita que um token vazado
    // martele o `auth.admin.deleteUser` do Supabase (C9.3.2).
    app.delete('/conta', { onRequest: ctx.guardaPrivadoIp }, async (req, reply) => {
      const usuarioId = await ctx.contaDoRequest(req, reply);
      if (!usuarioId) return reply;
      await gerenciadorConta.apagar(usuarioId);
      return reply.code(204).send();
    });
  }

  if (servicoAssinatura) {
    app.get('/conta/estado', { onRequest: ctx.guardaPrivadoIp }, async (req, reply) => {
      const usuarioId = await ctx.contaDoRequest(req, reply);
      if (!usuarioId) return reply;
      const estado = await servicoAssinatura.obterEstado(usuarioId);
      return reply.send(estado);
    });
  }
}
