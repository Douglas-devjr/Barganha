/**
 * Rotas privilegiadas de CURADORIA e OPERAÇÃO (C11/C12.5) — autorizadas por
 * token estático (`CURADORIA_TOKENS`), não por conta de usuário: dar a um
 * usuário qualquer o poder de aprovar preços ou reescrever o catálogo abriria
 * abuso.
 *
 * Negam fechado duas vezes: sem `autorizacaoCuradoria` configurada as rotas nem
 * sobem, e com ela o token é conferido em tempo constante a cada requisição.
 *
 * Todas passam por `guardaCuradoriaIp` (C9.3.2). O token autoriza QUEM entra,
 * mas não impede quantas vezes — e as rotas de fila varrem tabela. Sem teto, um
 * token vazado martelava o banco à vontade.
 */

import type {
  CasamentoSugestoesRequest,
  ConfirmacaoCasamentoRequest,
  DecisaoModeracaoRequest,
  EnriquecimentoProdutoRequest,
} from '@barganha/shared';
import type { FastifyInstance } from 'fastify';

import { type ContextoRotas, exigeCuradoria } from '../contexto';
import {
  SCHEMA_CASAMENTO,
  SCHEMA_CONFIRMACAO_CASAMENTO,
  SCHEMA_DECISAO,
  SCHEMA_DECISAO_DENUNCIA,
  SCHEMA_ENRIQUECIMENTO,
  SCHEMA_REPROCESSAR,
} from '../esquemas';

export function registrarRotasCuradoria(app: FastifyInstance, ctx: ContextoRotas): void {
  const {
    autorizacaoCuradoria,
    servicoModeracao,
    servicoDenuncia,
    servicoCuradoria,
    matcherTexto,
    servicoConfirmacaoCasamento,
    reprocessador,
  } = ctx.deps;

  // Sem autorização configurada, NADA de curadoria sobe.
  if (!autorizacaoCuradoria) return;
  const autorizado = (
    req: Parameters<typeof exigeCuradoria>[1],
    reply: Parameters<typeof exigeCuradoria>[2],
  ) => exigeCuradoria(autorizacaoCuradoria, req, reply);
  const opcoes = { onRequest: ctx.guardaCuradoriaIp };

  // ── Métricas (C10.2 + C10.4) ────────────────────────────────────────
  // Agregadas (contadores por UF, sem dado de cupom), mas NÃO públicas: expõem
  // volume por estado e a taxa de falha dos portais — inteligência operacional
  // que não precisa estar aberta. A partir da C10.4 vêm junto latência de
  // banco/HTTP, acerto de cache e o custo do processo (memória e CPU).
  //
  // `performance` fica ausente quando o coletor não foi injetado, em vez de vir
  // zerado: zero e "não medido" são diagnósticos opostos e não podem parecer
  // iguais para quem lê o painel.
  app.get('/metricas', opcoes, (req, reply) => {
    if (!autorizado(req, reply)) return reply;
    const performance = ctx.deps.metricasPerformance?.resumo();
    return reply.send({
      ...ctx.metricas.snapshot(),
      ...(performance ? { performance } : {}),
    });
  });

  if (servicoModeracao) {
    // Fila de moderação (C11.3) — pendentes, mais antigos primeiro.
    app.get('/moderacao/fila', opcoes, async (req, reply) => {
      if (!autorizado(req, reply)) return reply;
      return reply.send({ lancamentos: await servicoModeracao.listarFila() });
    });

    // Decisão da curadoria (C11.3) — aprovar publica no pool via gate; rejeitar não.
    app.post<{ Params: { id: string }; Body: DecisaoModeracaoRequest }>(
      '/moderacao/:id/decisao',
      { schema: SCHEMA_DECISAO, ...opcoes },
      async (req, reply) => {
        if (!autorizado(req, reply)) return reply;
        const resposta = await servicoModeracao.decidir(req.params.id, req.body);
        if (!resposta) return reply.code(404).send({ erro: 'Lançamento não encontrado.' });
        return reply.send(resposta);
      },
    );
  }

  if (servicoDenuncia) {
    // Fila de denúncias (C12.5) — pendentes, mais antigas primeiro.
    // NÃO expõe `usuarioId`: a curadoria decide pelo conteúdo (docs/04).
    app.get('/denuncia/fila', opcoes, async (req, reply) => {
      if (!autorizado(req, reply)) return reply;
      return reply.send({ denuncias: await servicoDenuncia.listarFila() });
    });

    // Decisão da curadoria (C12.5). Fecha o sinal; a correção do dado, quando
    // procedente, é feita pelas rotas de curadoria que já existem.
    app.post<{ Params: { id: string }; Body: { procedente: boolean; resolucao?: string } }>(
      '/denuncia/:id/decisao',
      { schema: SCHEMA_DECISAO_DENUNCIA, ...opcoes },
      async (req, reply) => {
        if (!autorizado(req, reply)) return reply;
        const ok = await servicoDenuncia.decidir(
          req.params.id,
          req.body.procedente,
          req.body.resolucao,
        );
        if (!ok) return reply.code(404).send({ erro: 'Denúncia não encontrada ou já decidida.' });
        return reply.send({ id: req.params.id, decidida: true });
      },
    );
  }

  if (servicoCuradoria) {
    // Enriquecimento de produto (C11.5) — só campos de exibição.
    app.post<{ Body: EnriquecimentoProdutoRequest }>(
      '/curadoria/produto',
      { schema: SCHEMA_ENRIQUECIMENTO, ...opcoes },
      async (req, reply) => {
        if (!autorizado(req, reply)) return reply;
        const resposta = await servicoCuradoria.enriquecer(req.body);
        if (!resposta) return reply.code(404).send({ erro: 'Produto não encontrado.' });
        return reply.send(resposta);
      },
    );
  }

  if (matcherTexto) {
    // Sugestões de casamento por texto (C3.5) — itens sem EAN. Só SUGERE, nunca
    // casa sozinho (docs/06): confirmar (gravar `produto_alias`) é decisão humana.
    app.post<{ Body: CasamentoSugestoesRequest }>(
      '/curadoria/casamento/sugestoes',
      { schema: SCHEMA_CASAMENTO, ...opcoes },
      async (req, reply) => {
        if (!autorizado(req, reply)) return reply;
        const sugestoes = await matcherTexto.sugerir(req.body.descricao, req.body.unidadeBase);
        return reply.send({ sugestoes });
      },
    );
  }

  if (servicoConfirmacaoCasamento) {
    // Confirmação de casamento por texto (C3.5) — grava o alias confirmado
    // depois que o curador aprova uma sugestão. O job `republicar-pool` refaz
    // os cupons com itens órfãos (mesma descrição normalizada).
    app.post<{ Body: ConfirmacaoCasamentoRequest }>(
      '/curadoria/casamento/confirmar',
      { schema: SCHEMA_CONFIRMACAO_CASAMENTO, ...opcoes },
      async (req, reply) => {
        if (!autorizado(req, reply)) return reply;
        const resposta = await servicoConfirmacaoCasamento.confirmar(req.body);
        return reply.send(resposta);
      },
    );
  }

  if (reprocessador) {
    // Reprocessamento retroativo (C11.1/C2.5) — re-enfileira QRs represados de
    // uma UF (parser novo entrou) ou de todas as suportadas (sem `uf`).
    app.post<{ Body: { uf?: string; limite?: number } }>(
      '/curadoria/reprocessar',
      { schema: SCHEMA_REPROCESSAR, ...opcoes },
      async (req, reply) => {
        if (!autorizado(req, reply)) return reply;
        const { uf, limite } = req.body;
        const opcoesReproc = limite !== undefined ? { limite } : {};
        const reenfileirados = uf
          ? await reprocessador.reprocessarUf(uf, opcoesReproc)
          : await reprocessador.reprocessarSuportadas(opcoesReproc);
        return reply.send({ reenfileirados });
      },
    );
  }
}
