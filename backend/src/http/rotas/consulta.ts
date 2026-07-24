/**
 * Rotas de LEITURA do pool — todas ANÔNIMAS (sem conta, docs/04).
 *
 *  • `POST /consulta/preco` (C4.1) — faixa típica do produto no recorte geo.
 *  • `POST /consulta/lista` (C12.1) — onde a cesta sai mais barata.
 *  • `POST /sync/estatisticas` (C4.2) — delta desde o cursor (offline).
 *
 * Nenhuma delas toca o mundo privado nem preenche `req.usuarioId` — é assim que
 * tem que ser. Compartilham UM teto de "leitura pública" por IP (anti-scraping).
 */

import type {
  ComparacaoListaRequest,
  ConsultaPrecoRequest,
  DeltaSyncRequest,
} from '@barganha/shared';
import type { FastifyInstance } from 'fastify';

import type { ContextoRotas } from '../contexto';
import { SCHEMA_COMPARACAO_LISTA, SCHEMA_CONSULTA, SCHEMA_SYNC } from '../esquemas';

export function registrarRotasConsulta(app: FastifyInstance, ctx: ContextoRotas): void {
  const { servicoConsulta, servicoComparacaoLista, servicoSync } = ctx.deps;

  app.post<{ Body: ConsultaPrecoRequest }>(
    '/consulta/preco',
    { schema: SCHEMA_CONSULTA, onRequest: ctx.guardaLeitura },
    async (req, reply) => {
      const resposta = await servicoConsulta.consultar(req.body);
      if (!resposta) {
        return reply.code(404).send({ erro: 'Sem dados para o produto consultado.' });
      }
      return reply.send(resposta);
    },
  );

  if (servicoComparacaoLista) {
    app.post<{ Body: ComparacaoListaRequest }>(
      '/consulta/lista',
      { schema: SCHEMA_COMPARACAO_LISTA, onRequest: ctx.guardaLeitura },
      async (req) => servicoComparacaoLista.comparar(req.body),
    );
  }

  app.post<{ Body: DeltaSyncRequest }>(
    '/sync/estatisticas',
    { schema: SCHEMA_SYNC, onRequest: ctx.guardaLeitura },
    async (req, reply) => {
      const resposta = await servicoSync.delta(req.body);
      return reply.send(resposta);
    },
  );
}
