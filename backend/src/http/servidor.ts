/**
 * Servidor HTTP (Fastify) do backend. Expõe:
 *  • Ingestão de QR (C2.1) — privada, exige conta; responde 202 (parsing é
 *    assíncrono na fila, não 200).
 *  • Conta anônima (C4.3) — cria o `usuarioId` que o app usa como Bearer.
 *  • Consulta de preço (C4.1) e delta sync (C4.2) — ANÔNIMOS: lêem só o pool
 *    compartilhado, sem conta (docs/04).
 *
 * Rate-limit (C9.3.2): criação de conta e os endpoints públicos de leitura têm
 * teto por janela (anti criação em massa / scraping do pool). Por trás de proxy
 * (C10), lembrar de habilitar `trustProxy` para o IP refletir o cliente real.
 *
 * As dependências são injetadas para o servidor ser testável com adaptadores em
 * memória (sem Supabase nem rede).
 */

import type { ConsultaPrecoRequest, DeltaSyncRequest, IngestaoQrRequest } from '@barganha/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import type { Autenticacao } from '../auth/autenticador';
import type { ServicoConta } from '../auth/servico-conta';
import type { ServicoConsulta } from '../consulta/servico-consulta';
import { ChaveAcessoInvalidaError, PayloadQrInvalidoError } from '../erros';
import type { ServicoIngestao } from '../ingestao/servico-ingestao';
import type { ServicoSync } from '../sync/servico-sync';
import { chavePorConta, guardaDeTaxa, LimitadorJanelaFixa, type OpcoesLimite } from './rate-limit';

/** Tetos de taxa por janela (C9.3.2). Sobrescrevíveis (testes/infra). */
export interface LimitesTaxa {
  /** Criação de conta anônima — por IP (anti criação em massa). */
  conta: OpcoesLimite;
  /** Leitura pública (consulta + sync somados) — por IP (anti scraping). */
  leituraPublica: OpcoesLimite;
  /** Ingestão de QR — por conta (Bearer), com fallback no IP. */
  ingestao: OpcoesLimite;
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

export const LIMITES_PADRAO: LimitesTaxa = {
  conta: { janelaMs: HORA, maximo: 20 },
  leituraPublica: { janelaMs: MINUTO, maximo: 120 },
  ingestao: { janelaMs: MINUTO, maximo: 60 },
};

export interface DependenciasHttp {
  servicoIngestao: ServicoIngestao;
  servicoConsulta: ServicoConsulta;
  servicoSync: ServicoSync;
  servicoConta: ServicoConta;
  /** Autenticação mínima (C4.3) — valida a conta nos endpoints privados. */
  autenticacao: Autenticacao;
  /** Tetos de taxa (C9.3.2). Omitido → `LIMITES_PADRAO`. */
  limites?: LimitesTaxa;
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

const SCHEMA_CONSULTA = {
  body: {
    type: 'object',
    additionalProperties: false,
    // Pelo menos um dos identificadores do produto (EAN principal, nome fallback).
    anyOf: [{ required: ['ean'] }, { required: ['nome'] }],
    properties: {
      ean: { type: 'string', minLength: 1 },
      nome: { type: 'string', minLength: 1 },
      municipio: { type: 'string', minLength: 1 },
      uf: { type: 'string', minLength: 2, maxLength: 2 },
    },
  },
} as const;

const SCHEMA_SYNC = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      cursor: { type: 'string', minLength: 1 },
      municipios: { type: 'array', items: { type: 'string', minLength: 1 } },
      produtoCanonicoIds: { type: 'array', items: { type: 'string', minLength: 1 } },
    },
  },
} as const;

export function construirServidor(deps: DependenciasHttp): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  const limites = deps.limites ?? LIMITES_PADRAO;

  // Limitadores de taxa (C9.3.2). Consulta e sync compartilham o MESMO
  // limitador: um teto único de "leitura pública" por IP.
  const guardaConta = guardaDeTaxa(new LimitadorJanelaFixa(limites.conta));
  const guardaLeitura = guardaDeTaxa(new LimitadorJanelaFixa(limites.leituraPublica));
  const guardaIngestao = guardaDeTaxa(new LimitadorJanelaFixa(limites.ingestao), {
    chave: chavePorConta,
  });

  app.get('/saude', () => ({ ok: true }));

  // ── Conta anônima (C4.3) ───────────────────────────────────────────
  app.post('/conta/anonima', { onRequest: guardaConta }, async (_req, reply) => {
    const resposta = await deps.servicoConta.criarAnonima();
    return reply.code(201).send(resposta);
  });

  // ── Ingestão de QR (C2.1) — privada ────────────────────────────────
  app.post<{ Body: IngestaoQrRequest }>(
    '/ingestao/qr',
    { schema: SCHEMA_INGESTAO, onRequest: guardaIngestao },
    async (req, reply) => {
      const usuarioId = await deps.autenticacao.resolver(req.headers);
      if (!usuarioId) {
        return reply.code(401).send({ erro: 'Usuário não identificado.' });
      }
      const resposta = await deps.servicoIngestao.ingerir(usuarioId, req.body);
      return reply.code(202).send(resposta);
    },
  );

  // ── Cupom do usuário (C6.3) — privado ──────────────────────────────
  app.get<{ Params: { id: string } }>('/ingestao/cupom/:id', async (req, reply) => {
    const usuarioId = await deps.autenticacao.resolver(req.headers);
    if (!usuarioId) {
      return reply.code(401).send({ erro: 'Usuário não identificado.' });
    }
    const cupom = await deps.servicoIngestao.obterCupom(usuarioId, req.params.id);
    if (!cupom) {
      // 404 também para cupom de outro dono — não vaza existência (docs/04).
      return reply.code(404).send({ erro: 'Cupom não encontrado.' });
    }
    return reply.send(cupom);
  });

  // ── Consulta de preço (C4.1) — anônima ─────────────────────────────
  app.post<{ Body: ConsultaPrecoRequest }>(
    '/consulta/preco',
    { schema: SCHEMA_CONSULTA, onRequest: guardaLeitura },
    async (req, reply) => {
      const resposta = await deps.servicoConsulta.consultar(req.body);
      if (!resposta) {
        return reply.code(404).send({ erro: 'Sem dados para o produto consultado.' });
      }
      return reply.send(resposta);
    },
  );

  // ── Delta sync (C4.2) — anônima ────────────────────────────────────
  app.post<{ Body: DeltaSyncRequest }>(
    '/sync/estatisticas',
    { schema: SCHEMA_SYNC, onRequest: guardaLeitura },
    async (req, reply) => {
      const resposta = await deps.servicoSync.delta(req.body);
      return reply.send(resposta);
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
