/**
 * Servidor HTTP (Fastify) do backend. Expõe:
 *  • Ingestão de QR (C2.1) — privada, exige login; responde 202 (parsing é
 *    assíncrono na fila, não 200).
 *  • Apagar conta (C4.3.1) — privada; direito ao apagamento (docs/04).
 *  • Consulta de preço (C4.1) e delta sync (C4.2) — ANÔNIMOS: lêem só o pool
 *    compartilhado, sem conta (docs/04).
 *
 * Auth (C4.3.1): em produção os endpoints privados exigem um JWT do Supabase
 * (login obrigatório — email/senha ou Google). A conta anônima de C4.3 sobrevive
 * só como afordância de teste/legado (`servicoConta` injetado nos e2e em memória).
 *
 * Rate-limit (C9.3.2): criação de conta e os endpoints públicos de leitura têm
 * teto por janela (anti criação em massa / scraping do pool). Por trás de proxy
 * (C10), lembrar de habilitar `trustProxy` para o IP refletir o cliente real.
 *
 * As dependências são injetadas para o servidor ser testável com adaptadores em
 * memória (sem Supabase nem rede).
 */

import type {
  CasamentoSugestoesRequest,
  ComparacaoListaRequest,
  ConsultaPrecoRequest,
  DecisaoModeracaoRequest,
  DeltaSyncRequest,
  EnriquecimentoProdutoRequest,
  IngestaoHtmlRequest,
  IngestaoQrRequest,
  LancamentoManualRequest,
} from '@barganha/shared';
import { UNIDADES_BASE } from '@barganha/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import type { Autenticacao } from '../auth/autenticador';
import type { AutorizacaoCuradoria } from '../auth/curadoria';
import type { GerenciadorConta } from '../auth/gerenciador-conta';
import type { ServicoConta } from '../auth/servico-conta';
import type { ServicoComparacaoLista } from '../consulta/servico-comparacao-lista';
import type { ServicoConsulta } from '../consulta/servico-consulta';
import type { ServicoCuradoria } from '../curadoria/servico-curadoria';
import {
  ChaveAcessoInvalidaError,
  HtmlDesafioError,
  HtmlErroPortalError,
  LancamentoInvalidoError,
  PayloadQrInvalidoError,
} from '../erros';
import type { MatcherTexto } from '../estatistica/casamento-texto';
import type { ServicoIngestao } from '../ingestao/servico-ingestao';
import type { ServicoModeracao } from '../moderacao/servico-moderacao';
import { registrarHtmlDebug } from '../observabilidade/debug-html';
import type { FonteMetricas } from '../observabilidade/telemetria';
import type { ReprocessadorRetroativo } from '../processamento/reprocessamento';
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
  /** Lista de compras comparada por loja (C12.1). Omitido → rota não sobe. */
  servicoComparacaoLista?: ServicoComparacaoLista;
  servicoSync: ServicoSync;
  /**
   * Conta anônima (C4.3) — afordância de testes/legado. Em produção o login é
   * obrigatório (Supabase Auth), então este serviço NÃO é injetado e a rota
   * `POST /conta/anonima` nem sobe. Presente → rota disponível (e2e em memória).
   */
  servicoConta?: ServicoConta;
  /**
   * Autenticação dos endpoints PRIVADOS (C4.3.1). Em produção valida o JWT do
   * Supabase (login real); em testes, o UUID opaco da conta anônima.
   */
  autenticacao: Autenticacao;
  /** Apagamento de conta (direito ao apagamento, docs/04). Omitido → rota não sobe. */
  gerenciadorConta?: GerenciadorConta;
  /** Lançamento manual de gôndola + moderação (C11.3). Omitido → rotas não sobem. */
  servicoModeracao?: ServicoModeracao;
  /** Enriquecimento de produto pela curadoria (C11.5). Omitido → rota não sobe. */
  servicoCuradoria?: ServicoCuradoria;
  /** Sugestões de casamento por texto p/ a curadoria (C3.5). Omitido → rota não sobe. */
  matcherTexto?: Pick<MatcherTexto, 'sugerir'>;
  /** Reprocessamento retroativo por UF (C11.1/C2.5) — gatilho operacional. */
  reprocessador?: ReprocessadorRetroativo;
  /** Autorização dos endpoints de CURADORIA (C11). Sem ela, as rotas não sobem. */
  autorizacaoCuradoria?: AutorizacaoCuradoria;
  /** Fonte de métricas de parsing por estado (C10.2) — exposta em `GET /metricas`. */
  metricas?: FonteMetricas;
  /** Tetos de taxa (C9.3.2). Omitido → `LIMITES_PADRAO`. */
  limites?: LimitesTaxa;
  /** Confia no `X-Forwarded-For` atrás de proxy/LB (C10) — IP real p/ rate-limit. */
  trustProxy?: boolean;
  logger?: boolean;
}

/** Snapshot vazio — quando o servidor sobe sem coletor de métricas (ex.: testes). */
const SEM_METRICAS: FonteMetricas = {
  snapshot: () => ({ geradoEm: new Date().toISOString(), totais: {}, porUf: {} }),
};

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

// Ingestão por HTML (C2.6) — o app envia o HTML da nota renderizada no WebView.
// Body maior que o padrão: a página da SEFAZ traz scripts/estilos embutidos.
const MB = 1024 * 1024;
const SCHEMA_INGESTAO_HTML = {
  bodyLimit: 4 * MB,
  schema: {
    body: {
      type: 'object',
      required: ['html'],
      additionalProperties: false,
      properties: {
        html: { type: 'string', minLength: 1 },
      },
    },
  },
} as const;

// Lista comparada (C12.1) — teto de 40 itens espelha o benchmark de mercado
// (Preço da Hora BA) e limita o custo da consulta anônima.
const SCHEMA_COMPARACAO_LISTA = {
  body: {
    type: 'object',
    required: ['itens'],
    additionalProperties: false,
    properties: {
      itens: {
        type: 'array',
        minItems: 1,
        maxItems: 40,
        items: {
          type: 'object',
          required: ['produtoCanonicoId'],
          additionalProperties: false,
          properties: {
            produtoCanonicoId: { type: 'string', minLength: 1 },
            quantidade: { type: 'number', exclusiveMinimum: 0 },
          },
        },
      },
      municipio: { type: 'string', minLength: 1 },
      uf: { type: 'string', minLength: 2, maxLength: 2 },
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

// Lançamento manual de gôndola (C11.3) — preço de prateleira informado à mão.
const SCHEMA_LANCAMENTO = {
  body: {
    type: 'object',
    required: ['ean', 'descricao', 'unidade', 'valorUnitario', 'lojaCnpj'],
    additionalProperties: false,
    properties: {
      ean: { type: 'string', minLength: 1 },
      descricao: { type: 'string', minLength: 1 },
      unidade: { type: 'string', minLength: 1 },
      valorUnitario: { type: 'number', exclusiveMinimum: 0 },
      lojaCnpj: { type: 'string', minLength: 1 },
      municipio: { type: 'string', minLength: 1 },
      uf: { type: 'string', minLength: 2, maxLength: 2 },
      emPromocao: { type: 'boolean' },
    },
  },
} as const;

// Decisão de curadoria sobre um lançamento (C11.3).
const SCHEMA_DECISAO = {
  body: {
    type: 'object',
    required: ['decisao'],
    additionalProperties: false,
    properties: {
      decisao: { type: 'string', enum: ['aprovar', 'rejeitar'] },
      motivo: { type: 'string', minLength: 1 },
    },
  },
} as const;

// Enriquecimento de produto pela curadoria (C11.5).
const SCHEMA_ENRIQUECIMENTO = {
  body: {
    type: 'object',
    additionalProperties: false,
    // Pelo menos um alvo do produto (id direto ou EAN).
    anyOf: [{ required: ['produtoCanonicoId'] }, { required: ['ean'] }],
    properties: {
      produtoCanonicoId: { type: 'string', minLength: 1 },
      ean: { type: 'string', minLength: 1 },
      nomeExibicao: { type: 'string', minLength: 1 },
      marca: { type: 'string', minLength: 1 },
      categoria: { type: 'string', minLength: 1 },
      imagemUrl: { type: 'string', minLength: 1 },
    },
  },
} as const;

// Sugestões de casamento por texto (C3.5) — curadoria.
const SCHEMA_CASAMENTO = {
  body: {
    type: 'object',
    required: ['descricao', 'unidadeBase'],
    additionalProperties: false,
    properties: {
      descricao: { type: 'string', minLength: 1 },
      unidadeBase: { type: 'string', enum: [...UNIDADES_BASE] },
    },
  },
} as const;

// Gatilho de reprocessamento retroativo por UF (C11.1/C2.5).
const SCHEMA_REPROCESSAR = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      uf: { type: 'string', minLength: 2, maxLength: 2 },
      limite: { type: 'integer', minimum: 1 },
    },
  },
} as const;

export function construirServidor(deps: DependenciasHttp): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: deps.trustProxy ?? false });
  const limites = deps.limites ?? LIMITES_PADRAO;
  const metricas = deps.metricas ?? SEM_METRICAS;

  // Limitadores de taxa (C9.3.2). Consulta e sync compartilham o MESMO
  // limitador: um teto único de "leitura pública" por IP.
  const guardaConta = guardaDeTaxa(new LimitadorJanelaFixa(limites.conta));
  const guardaLeitura = guardaDeTaxa(new LimitadorJanelaFixa(limites.leituraPublica));
  const guardaIngestao = guardaDeTaxa(new LimitadorJanelaFixa(limites.ingestao), {
    chave: chavePorConta,
  });

  app.get('/saude', () => ({ ok: true }));

  // ── Métricas de parsing por estado (C10.2) — operação/observabilidade ──
  // Anônima e agregada (contadores por UF, sem dado de cupom). Em produção,
  // restringir a rede interna/scraper de métricas via proxy.
  app.get('/metricas', () => metricas.snapshot());

  // ── Conta anônima (C4.3) — afordância de teste/legado ──────────────
  // Em produção (login obrigatório, Supabase Auth) `servicoConta` não é
  // injetado: a rota nem sobe, então não há como obter conta sem autenticar.
  const { servicoConta, gerenciadorConta } = deps;
  if (servicoConta) {
    app.post('/conta/anonima', { onRequest: guardaConta }, async (_req, reply) => {
      const resposta = await servicoConta.criarAnonima();
      return reply.code(201).send(resposta);
    });
  }

  // ── Apagar conta (C4.3.1) — PRIVADO. Direito ao apagamento (docs/04) ──
  // Remove a conta de auth e, em cascata, todo o histórico privado. O pool
  // anônimo não é tocado (observações são soltas e sem vínculo com o usuário).
  // Rate-limit por conta (mesmo teto da ingestão): evita que um token vazado
  // martele o `auth.admin.deleteUser` do Supabase (C9.3.2).
  if (gerenciadorConta) {
    app.delete('/conta', { onRequest: guardaIngestao }, async (req, reply) => {
      const usuarioId = await deps.autenticacao.resolver(req.headers);
      if (!usuarioId) {
        return reply.code(401).send({ erro: 'Usuário não identificado.' });
      }
      await gerenciadorConta.apagar(usuarioId);
      return reply.code(204).send();
    });
  }

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

  // ── Ingestão por HTML (C2.6) — privada ─────────────────────────────
  // Quando o portal exige navegador/reCAPTCHA (ex.: RJ), o app colhe o HTML da
  // nota no WebView e o envia aqui; o backend PARSEIA (nunca o app) e responde o
  // cupom já processado. Escopo do dono; 404 não vaza cupom de outro usuário.
  app.post<{ Params: { id: string }; Body: IngestaoHtmlRequest }>(
    '/ingestao/cupom/:id/html',
    { ...SCHEMA_INGESTAO_HTML, onRequest: guardaIngestao },
    async (req, reply) => {
      const usuarioId = await deps.autenticacao.resolver(req.headers);
      if (!usuarioId) {
        return reply.code(401).send({ erro: 'Usuário não identificado.' });
      }
      // Depuração (dev): salva o ESQUELETO do HTML recebido (sem PII) para ajustar
      // os seletores do parser ao layout real do portal. No-op fora de dev.
      registrarHtmlDebug(req.body.html, `cupom-${req.params.id}`);
      const cupom = await deps.servicoIngestao.ingerirHtml(usuarioId, req.params.id, req.body.html);
      if (!cupom) {
        return reply.code(404).send({ erro: 'Cupom não encontrado.' });
      }
      return reply.send(cupom);
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

  // ── Lista de compras comparada (C12.1) — anônima ────────────────────
  // Mesmo mundo da consulta: lê só o pool (estatística por loja); sem conta.
  if (deps.servicoComparacaoLista) {
    const comparacao = deps.servicoComparacaoLista;
    app.post<{ Body: ComparacaoListaRequest }>(
      '/consulta/lista',
      { schema: SCHEMA_COMPARACAO_LISTA, onRequest: guardaLeitura },
      async (req) => comparacao.comparar(req.body),
    );
  }

  // ── Delta sync (C4.2) — anônima ────────────────────────────────────
  app.post<{ Body: DeltaSyncRequest }>(
    '/sync/estatisticas',
    { schema: SCHEMA_SYNC, onRequest: guardaLeitura },
    async (req, reply) => {
      const resposta = await deps.servicoSync.delta(req.body);
      return reply.send(resposta);
    },
  );

  // ── Lançamento manual de gôndola (C11.3) — PRIVADO (exige conta) ────
  // A geo é pela LOJA (CNPJ); o usuarioId fica só no registro de moderação
  // (anti-abuso), nunca no pool (docs/04). Reaproveita o teto por conta da
  // ingestão (anti-spam de fila).
  const { servicoModeracao, servicoCuradoria, autorizacaoCuradoria, reprocessador, matcherTexto } =
    deps;
  if (servicoModeracao) {
    app.post<{ Body: LancamentoManualRequest }>(
      '/lancamento-manual',
      { schema: SCHEMA_LANCAMENTO, onRequest: guardaIngestao },
      async (req, reply) => {
        const usuarioId = await deps.autenticacao.resolver(req.headers);
        if (!usuarioId) {
          return reply.code(401).send({ erro: 'Usuário não identificado.' });
        }
        const resposta = await servicoModeracao.lancar(usuarioId, req.body);
        return reply.code(202).send(resposta);
      },
    );
  }

  // ── Curadoria (C11) — endpoints privilegiados (token estático, C4.3 espírito).
  // Negam fechado: sem `autorizacaoCuradoria` configurada, as rotas nem sobem.
  const exigeCuradoria = (req: { headers: Record<string, unknown> }): boolean =>
    autorizacaoCuradoria!.autorizado(req.headers as never);

  if (servicoModeracao && autorizacaoCuradoria) {
    // Fila de moderação (C11.3) — pendentes, mais antigos primeiro.
    app.get('/moderacao/fila', async (req, reply) => {
      if (!exigeCuradoria(req))
        return reply.code(403).send({ erro: 'Acesso restrito à curadoria.' });
      return reply.send({ lancamentos: await servicoModeracao.listarFila() });
    });

    // Decisão da curadoria (C11.3) — aprovar publica no pool via gate; rejeitar não.
    app.post<{ Params: { id: string }; Body: DecisaoModeracaoRequest }>(
      '/moderacao/:id/decisao',
      { schema: SCHEMA_DECISAO },
      async (req, reply) => {
        if (!exigeCuradoria(req)) {
          return reply.code(403).send({ erro: 'Acesso restrito à curadoria.' });
        }
        const resposta = await servicoModeracao.decidir(req.params.id, req.body);
        if (!resposta) return reply.code(404).send({ erro: 'Lançamento não encontrado.' });
        return reply.send(resposta);
      },
    );
  }

  if (servicoCuradoria && autorizacaoCuradoria) {
    // Enriquecimento de produto (C11.5) — só campos de exibição.
    app.post<{ Body: EnriquecimentoProdutoRequest }>(
      '/curadoria/produto',
      { schema: SCHEMA_ENRIQUECIMENTO },
      async (req, reply) => {
        if (!exigeCuradoria(req)) {
          return reply.code(403).send({ erro: 'Acesso restrito à curadoria.' });
        }
        const resposta = await servicoCuradoria.enriquecer(req.body);
        if (!resposta) return reply.code(404).send({ erro: 'Produto não encontrado.' });
        return reply.send(resposta);
      },
    );
  }

  if (matcherTexto && autorizacaoCuradoria) {
    // Sugestões de casamento por texto (C3.5) — itens sem EAN. Só SUGERE, nunca
    // casa sozinho (docs/06): confirmar (gravar `produto_alias`) é decisão humana.
    app.post<{ Body: CasamentoSugestoesRequest }>(
      '/curadoria/casamento/sugestoes',
      { schema: SCHEMA_CASAMENTO },
      async (req, reply) => {
        if (!exigeCuradoria(req)) {
          return reply.code(403).send({ erro: 'Acesso restrito à curadoria.' });
        }
        const sugestoes = await matcherTexto.sugerir(req.body.descricao, req.body.unidadeBase);
        return reply.send({ sugestoes });
      },
    );
  }

  if (reprocessador && autorizacaoCuradoria) {
    // Reprocessamento retroativo (C11.1/C2.5) — re-enfileira QRs represados de
    // uma UF (parser novo entrou) ou de todas as suportadas (sem `uf`).
    app.post<{ Body: { uf?: string; limite?: number } }>(
      '/curadoria/reprocessar',
      { schema: SCHEMA_REPROCESSAR },
      async (req, reply) => {
        if (!exigeCuradoria(req)) {
          return reply.code(403).send({ erro: 'Acesso restrito à curadoria.' });
        }
        const { uf, limite } = req.body;
        const opcoes = limite !== undefined ? { limite } : {};
        const reenfileirados = uf
          ? await reprocessador.reprocessarUf(uf, opcoes)
          : await reprocessador.reprocessarSuportadas(opcoes);
        return reply.send({ reenfileirados });
      },
    );
  }

  app.setErrorHandler((erro: FastifyError, req, reply) => {
    if (erro.validation) {
      return reply.code(400).send({ erro: 'Requisição inválida.', detalhes: erro.validation });
    }
    if (
      erro instanceof PayloadQrInvalidoError ||
      erro instanceof ChaveAcessoInvalidaError ||
      erro instanceof LancamentoInvalidoError
    ) {
      return reply.code(400).send({ erro: erro.message });
    }
    // HTML ainda é a página de desafio (C2.6): não é falha do cupom — o app deve
    // reabrir o WebView e reenviar quando a nota tiver renderizado. 422. O
    // `codigo` distingue do erro de portal abaixo, que pede outra reação do app.
    if (erro instanceof HtmlDesafioError) {
      return reply.code(422).send({ erro: erro.message, codigo: 'desafio' });
    }
    // Portal recusou a verificação (reCAPTCHA) e caiu na página de erro: também
    // 422 (transitório, cupom intacto), mas o app deve RECARREGAR a consulta
    // (token novo) em vez de seguir esperando nesta página, que é terminal.
    if (erro instanceof HtmlErroPortalError) {
      return reply.code(422).send({ erro: erro.message, codigo: 'erro_portal' });
    }
    req.log.error(erro);
    return reply.code(500).send({ erro: 'Erro interno.' });
  });

  return app;
}
