/**
 * Rotas de CONTRIBUIÇÃO do usuário — PRIVADAS (exigem conta).
 *
 *  • `POST /lancamento-manual` (C11.3) — preço de gôndola informado à mão. A geo
 *    é pela LOJA (CNPJ); o `usuarioId` fica só no registro de moderação
 *    (anti-abuso), nunca no pool (docs/04).
 *  • `POST /denuncia` (C12.5) — "o típico deste produto aqui está errado". O
 *    alvo é PRODUTO + GEO, nunca uma `observacao_preco`: não existe ponteiro de
 *    usuário para linha do pool anônimo (decisão travada nº3). Denunciar não
 *    publica nada — só enfileira sinal para a curadoria.
 *
 * Ambas reaproveitam o teto por conta da ingestão (anti-spam de fila).
 */

import type { DenunciaPrecoRequest, LancamentoManualRequest } from '@barganha/shared';
import type { FastifyInstance } from 'fastify';

import type { ContextoRotas } from '../contexto';
import { SCHEMA_DENUNCIA, SCHEMA_LANCAMENTO } from '../esquemas';

export function registrarRotasContribuicao(app: FastifyInstance, ctx: ContextoRotas): void {
  const { servicoModeracao, servicoDenuncia } = ctx.deps;

  if (servicoModeracao) {
    app.post<{ Body: LancamentoManualRequest }>(
      '/lancamento-manual',
      { schema: SCHEMA_LANCAMENTO, onRequest: ctx.guardaPrivadoIp },
      async (req, reply) => {
        const usuarioId = await ctx.contaDoRequest(req, reply);
        if (!usuarioId) return reply;
        const resposta = await servicoModeracao.lancar(usuarioId, req.body);
        return reply.code(202).send(resposta);
      },
    );
  }

  if (servicoDenuncia) {
    app.post<{ Body: DenunciaPrecoRequest }>(
      '/denuncia',
      { schema: SCHEMA_DENUNCIA, onRequest: ctx.guardaPrivadoIp },
      async (req, reply) => {
        const usuarioId = await ctx.contaDoRequest(req, reply);
        if (!usuarioId) return reply;
        const resposta = await servicoDenuncia.denunciar(usuarioId, req.body);
        return reply.code(202).send(resposta);
      },
    );
  }
}
