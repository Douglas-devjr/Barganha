/**
 * Servidor HTTP (Fastify) da captura. Expõe o endpoint de ingestão de QR
 * (C2.1) e um health check. O parsing roda assíncrono na fila — por isso a
 * ingestão responde 202 (aceito para processamento), não 200.
 *
 * As dependências são injetadas para o servidor ser testável com adaptadores
 * em memória (sem Supabase nem rede). A autenticação aqui é mínima (header
 * `x-usuario-id`); a auth de verdade (conta anônima) é C4.3.
 */

import type { IngestaoQrRequest } from '@barganha/shared';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';

import { ChaveAcessoInvalidaError, PayloadQrInvalidoError } from '../erros';
import type { ServicoIngestao } from '../ingestao/servico-ingestao';

export interface DependenciasHttp {
  servicoIngestao: ServicoIngestao;
  /** Resolve o usuário do request (auth mínima — real em C4.3). */
  resolverUsuarioId?: (req: FastifyRequest) => string | undefined;
  logger?: boolean;
}

const SCHEMA_INGESTAO = {
  body: {
    type: 'object',
    required: ['qrPayload', 'capturadoEm'],
    additionalProperties: false,
    properties: {
      qrPayload: { type: 'string', minLength: 1 },
      capturadoEm: { type: 'string', minLength: 1 },
    },
  },
} as const;

function usuarioPorHeader(req: FastifyRequest): string | undefined {
  const valor = req.headers['x-usuario-id'];
  return typeof valor === 'string' && valor.length > 0 ? valor : undefined;
}

export function construirServidor(deps: DependenciasHttp): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  const resolverUsuarioId = deps.resolverUsuarioId ?? usuarioPorHeader;

  app.get('/saude', () => ({ ok: true }));

  app.post<{ Body: IngestaoQrRequest }>(
    '/ingestao/qr',
    { schema: SCHEMA_INGESTAO },
    async (req, reply) => {
      const usuarioId = resolverUsuarioId(req);
      if (!usuarioId) {
        return reply.code(401).send({ erro: 'Usuário não identificado.' });
      }
      const resposta = await deps.servicoIngestao.ingerir(usuarioId, req.body);
      return reply.code(202).send(resposta);
    },
  );

  app.setErrorHandler((erro: FastifyError, req, reply) => {
    if (erro.validation) {
      return reply.code(400).send({ erro: 'Requisição inválida.', detalhes: erro.validation });
    }
    if (erro instanceof PayloadQrInvalidoError || erro instanceof ChaveAcessoInvalidaError) {
      return reply.code(400).send({ erro: erro.message });
    }
    req.log.error(erro);
    return reply.code(500).send({ erro: 'Erro interno.' });
  });

  return app;
}
