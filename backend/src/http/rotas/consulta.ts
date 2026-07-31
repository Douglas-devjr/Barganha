/**
 * Rotas de LEITURA do pool — todas ANÔNIMAS (sem conta, docs/04).
 *
 *  • `POST /consulta/preco` (C4.1) — faixa típica do produto no recorte geo.
 *  • `POST /consulta/produtos` (C4.4) — catálogo regional (busca/populares).
 *  • `POST /consulta/lista` (C12.1) — onde a cesta sai mais barata.
 *  • `POST /sync/estatisticas` (C4.2) — delta desde o cursor (offline).
 *  • `POST /sync/produtos` (C4.5) — nome/marca/categoria dos ids em cache.
 *
 * Nenhuma delas toca o mundo privado nem preenche `req.usuarioId` — é assim que
 * tem que ser. Compartilham UM teto de "leitura pública" por IP (anti-scraping).
 */

import type {
  BuscaProdutosRequest,
  ComparacaoListaRequest,
  ConsultaPrecoRequest,
  DeltaSyncRequest,
  SyncProdutosRequest,
} from '@barganha/shared';
import type { FastifyInstance } from 'fastify';

import type { ContextoRotas } from '../contexto';
import {
  SCHEMA_BUSCA_PRODUTOS,
  SCHEMA_COMPARACAO_LISTA,
  SCHEMA_CONSULTA,
  SCHEMA_SYNC,
  SCHEMA_SYNC_PRODUTOS,
} from '../esquemas';

export function registrarRotasConsulta(app: FastifyInstance, ctx: ContextoRotas): void {
  const {
    servicoConsulta,
    servicoBuscaProdutos,
    servicoComparacaoLista,
    servicoSync,
    servicoSyncCatalogo,
  } = ctx.deps;

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

  /**
   * C4.4 — catálogo regional. Sempre 200: lista vazia é resposta legítima ("a
   * sua região ainda não tem preço para isso"), não erro. É o que sustenta o
   * app de quem nunca escaneou um cupom (docs/20).
   */
  if (servicoBuscaProdutos) {
    app.post<{ Body: BuscaProdutosRequest }>(
      '/consulta/produtos',
      { schema: SCHEMA_BUSCA_PRODUTOS, onRequest: ctx.guardaLeitura },
      async (req) => servicoBuscaProdutos.buscar(req.body),
    );
  }

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

  /**
   * C4.5 — delta de catálogo. Sempre 200: id sem resumo apenas não volta na
   * lista (o app trata como "ainda sem nome"), porque um 404 aqui derrubaria o
   * lote inteiro por causa de um produto que saiu do catálogo.
   */
  if (servicoSyncCatalogo) {
    app.post<{ Body: SyncProdutosRequest }>(
      '/sync/produtos',
      { schema: SCHEMA_SYNC_PRODUTOS, onRequest: ctx.guardaLeitura },
      async (req) => servicoSyncCatalogo.produtos(req.body),
    );
  }
}
