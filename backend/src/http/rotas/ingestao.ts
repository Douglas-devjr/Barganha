/**
 * Rotas de INGESTÃO (C2) — todas PRIVADAS (exigem login).
 *
 *  • `POST /ingestao/qr` (C2.1) — recebe o QR cru (ou a chave de acesso
 *    digitada, C2.7) e responde 202: o parsing é assíncrono, na fila.
 *  • `POST /ingestao/cupom/:id/html` (C2.6) — quando o portal exige
 *    navegador/reCAPTCHA, o app colhe o HTML da nota no WebView e o envia aqui.
 *    O backend PARSEIA (nunca o app, decisão travada nº2).
 *  • `GET /ingestao/cupom/:id` (C6.3) — estado/itens do próprio cupom.
 *  • `DELETE /ingestao/cupom/:id` — apagamento do histórico privado (docs/04).
 *
 * Escopo do dono em todas: cupom de outro usuário responde 404, igual a
 * inexistente — não vaza existência.
 */

import type { IngestaoHtmlRequest, IngestaoQrRequest } from '@barganha/shared';
import type { FastifyInstance } from 'fastify';

import { registrarHtmlDebug } from '../../observabilidade/debug-html';
import type { ContextoRotas } from '../contexto';
import { SCHEMA_INGESTAO, SCHEMA_INGESTAO_HTML } from '../esquemas';

export function registrarRotasIngestao(app: FastifyInstance, ctx: ContextoRotas): void {
  const { servicoIngestao } = ctx.deps;

  app.post<{ Body: IngestaoQrRequest }>(
    '/ingestao/qr',
    { schema: SCHEMA_INGESTAO, onRequest: ctx.guardaPrivadoIp },
    async (req, reply) => {
      const usuarioId = await ctx.contaDoRequest(req, reply);
      if (!usuarioId) return reply;
      const resposta = await servicoIngestao.ingerir(usuarioId, req.body);
      return reply.code(202).send(resposta);
    },
  );

  app.post<{ Params: { id: string }; Body: IngestaoHtmlRequest }>(
    '/ingestao/cupom/:id/html',
    { ...SCHEMA_INGESTAO_HTML, onRequest: ctx.guardaPrivadoIp },
    async (req, reply) => {
      const usuarioId = await ctx.contaDoRequest(req, reply);
      if (!usuarioId) return reply;
      // Depuração (dev): salva o ESQUELETO do HTML recebido (sem PII) para ajustar
      // os seletores do parser ao layout real do portal. No-op fora de dev.
      registrarHtmlDebug(req.body.html, `cupom-${req.params.id}`);
      const cupom = await servicoIngestao.ingerirHtml(usuarioId, req.params.id, req.body.html);
      if (!cupom) {
        return reply.code(404).send({ erro: 'Cupom não encontrado.' });
      }
      return reply.send(cupom);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/ingestao/cupom/:id',
    { onRequest: ctx.guardaPrivadoIp },
    async (req, reply) => {
      const usuarioId = await ctx.contaDoRequest(req, reply);
      if (!usuarioId) return reply;
      const cupom = await servicoIngestao.obterCupom(usuarioId, req.params.id);
      if (!cupom) {
        // 404 também para cupom de outro dono — não vaza existência (docs/04).
        return reply.code(404).send({ erro: 'Cupom não encontrado.' });
      }
      return reply.send(cupom);
    },
  );

  // Apagar o próprio cupom (docs/04). 204 sem corpo; 404 quando não é seu.
  // O pool anônimo NÃO é afetado — não existe ponteiro do cupom para as
  // observações (decisão travada nº3). A UI explica isso ao usuário.
  app.delete<{ Params: { id: string } }>(
    '/ingestao/cupom/:id',
    { onRequest: ctx.guardaPrivadoIp },
    async (req, reply) => {
      const usuarioId = await ctx.contaDoRequest(req, reply);
      if (!usuarioId) return reply;
      const apagado = await servicoIngestao.apagarCupom(usuarioId, req.params.id);
      if (!apagado) {
        return reply.code(404).send({ erro: 'Cupom não encontrado.' });
      }
      return reply.code(204).send();
    },
  );
}
