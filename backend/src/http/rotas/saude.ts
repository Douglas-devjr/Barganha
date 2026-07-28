/**
 * C10.4 — Rotas de saúde. DUAS, de propósito, porque respondem a perguntas
 * diferentes e confundi-las é o que quebra deploy em produção:
 *
 *  • `GET /saude`        — LIVENESS + detalhe. Responde 200 sempre que o processo
 *    está de pé, mesmo degradado, e entrega o relatório inteiro no corpo. É o que
 *    o cron `manter-api-acordada` chama e o que um humano abre para investigar.
 *
 *  • `GET /saude/pronto` — READINESS. 503 quando o relatório diz `falho`, isto é,
 *    quando ESTA VERSÃO do código não serve. É o `healthCheckPath` do Render e o
 *    gatilho do rollback automático.
 *
 * Se `/saude` devolvesse 503 em degradação, o cron de 10 min viraria alarme falso
 * a cada oscilação do Supabase. Se `/saude/pronto` devolvesse 503 em degradação,
 * uma queda do Supabase reprovaria o deploy do hotfix que conserta o incidente.
 *
 * Sem gate de taxa e sem autenticação: é a sonda da plataforma, e um health check
 * que exige credencial não é chamado por quem mais precisa dele. Em compensação o
 * corpo não expõe nada sensível — nomes de sonda, estados e motivos sanitizados.
 */

import type { FastifyInstance } from 'fastify';

import type { ContextoRotas } from '../contexto';

export function registrarRotasSaude(app: FastifyInstance, ctx: ContextoRotas): void {
  app.get('/saude', async (_req, reply) => {
    const relatorio = await ctx.saude.relatorio();
    // `ok` mantido por compatibilidade: o cron e qualquer sonda antiga apontam
    // para cá esperando um corpo JSON simples. Agora ele vem acompanhado.
    return reply.send({ ok: relatorio.status !== 'falho', ...relatorio });
  });

  app.get('/saude/pronto', async (_req, reply) => {
    const relatorio = await ctx.saude.relatorio();
    const pronto = relatorio.status !== 'falho';
    return reply.code(pronto ? 200 : 503).send({ pronto, ...relatorio });
  });
}
