/**
 * Esquemas de validação (JSON Schema) dos corpos de requisição.
 *
 * Ficam juntos e fora dos handlers por dois motivos: o Fastify os compila uma
 * vez na subida (validar é caminho quente), e ter o contrato de entrada de todas
 * as rotas num lugar só torna óbvio o que o backend aceita. Todos usam
 * `additionalProperties: false` — campo desconhecido é 400, nunca ignorado em
 * silêncio.
 */

import { MOTIVOS_DENUNCIA, UNIDADES_BASE } from '@barganha/shared';

export const SCHEMA_INGESTAO = {
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
export const SCHEMA_INGESTAO_HTML = {
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
export const SCHEMA_COMPARACAO_LISTA = {
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

export const SCHEMA_CONSULTA = {
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

// Busca no catálogo regional (C4.4) — tudo opcional: sem `termo` são os
// populares da região; o teto do `limite` é do servidor, não do cliente.
export const SCHEMA_BUSCA_PRODUTOS = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      termo: { type: 'string', maxLength: 120 },
      municipio: { type: 'string', minLength: 1 },
      uf: { type: 'string', minLength: 2, maxLength: 2 },
      limite: { type: 'integer', minimum: 1 },
    },
  },
} as const;

export const SCHEMA_SYNC = {
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
export const SCHEMA_LANCAMENTO = {
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

// Denúncia de preço (C12.5) — sinal de curadoria; NÃO publica nada no pool.
export const SCHEMA_DENUNCIA = {
  body: {
    type: 'object',
    required: ['produtoCanonicoId', 'motivo'],
    additionalProperties: false,
    properties: {
      produtoCanonicoId: { type: 'string', minLength: 1 },
      motivo: { type: 'string', enum: [...MOTIVOS_DENUNCIA] },
      municipio: { type: 'string', minLength: 1 },
      uf: { type: 'string', minLength: 2, maxLength: 2 },
      comentario: { type: 'string', maxLength: 500 },
    },
  },
} as const;

// Decisão da curadoria sobre uma denúncia (C12.5).
export const SCHEMA_DECISAO_DENUNCIA = {
  body: {
    type: 'object',
    required: ['procedente'],
    additionalProperties: false,
    properties: {
      procedente: { type: 'boolean' },
      resolucao: { type: 'string', maxLength: 500 },
    },
  },
} as const;

// Decisão de curadoria sobre um lançamento (C11.3).
export const SCHEMA_DECISAO = {
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
export const SCHEMA_ENRIQUECIMENTO = {
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
export const SCHEMA_CASAMENTO = {
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
export const SCHEMA_REPROCESSAR = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      uf: { type: 'string', minLength: 2, maxLength: 2 },
      limite: { type: 'integer', minimum: 1 },
    },
  },
} as const;
