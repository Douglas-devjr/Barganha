/**
 * Servidor HTTP (Fastify) do backend — MONTAGEM apenas.
 *
 * As rotas vivem em `rotas/*.ts`, agrupadas por assunto: conta, ingestão
 * (privado), consulta/sync (anônimo), contribuição (privado) e curadoria
 * (token privilegiado). Aqui ficam só as decisões que valem para o processo
 * inteiro: logger, trustProxy, os limitadores de taxa, a porta única de
 * autenticação e o handler de erros.
 *
 * Auth (C4.3.1): em produção os endpoints privados exigem um JWT do Supabase
 * (login obrigatório — email/senha ou Google). A conta anônima de C4.3 sobrevive
 * só como afordância de teste/legado (`servicoConta` injetado nos e2e em memória).
 *
 * Rate-limit (C9.3.2): conta, leitura pública, endpoints privados (por IP antes
 * de autenticar e por CONTA depois) e curadoria têm teto por janela. Por trás de
 * proxy (C10), habilitar `trustProxy` para o IP refletir o cliente real.
 *
 * As dependências são injetadas para o servidor ser testável com adaptadores em
 * memória (sem Supabase nem rede).
 */

import { gerarRequestId, HEADER_REQUEST_ID, sanitizarRequestId } from '@barganha/shared';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import { opcoesLogFastify } from '../observabilidade/log';
import { MonitorSaude } from '../observabilidade/saude';
import type { FonteMetricas } from '../observabilidade/telemetria';
import type { ContextoRotas } from './contexto';
import { type DependenciasHttp, LIMITES_PADRAO } from './dependencias';
import { tratarErro } from './erros-http';
import { LimitadorJanelaFixaPostgres } from './limitador-postgres';
import { barrarPorConta, guardaDeTaxa, LimitadorJanelaFixa } from './rate-limit';
import { registrarRotasAlertas } from './rotas/alertas';
import { registrarRotasConsulta } from './rotas/consulta';
import { registrarRotasConta } from './rotas/conta';
import { registrarRotasContribuicao } from './rotas/contribuicao';
import { registrarRotasCuradoria } from './rotas/curadoria';
import { registrarRotasIngestao } from './rotas/ingestao';
import { registrarRotasSaude } from './rotas/saude';

export { type DependenciasHttp, LIMITES_PADRAO, type LimitesTaxa } from './dependencias';

declare module 'fastify' {
  interface FastifyRequest {
    /** Conta autenticada (C4.3.1). Só nas rotas PRIVADAS; anônimas não o têm. */
    usuarioId?: string;
  }
}

/** Snapshot vazio — quando o servidor sobe sem coletor de métricas (ex.: testes). */
const SEM_METRICAS: FonteMetricas = {
  snapshot: () => ({ geradoEm: new Date().toISOString(), totais: {}, porUf: {}, unidadesRecusadas: {} }),
};

/**
 * Monitor sem sondas — usado quando ninguém injetou um (testes e2e em memória).
 * Reporta `ok`, que é honesto: não há dependência externa para estar quebrada.
 */
const semSondas = (): MonitorSaude =>
  new MonitorSaude([], { versao: 'desconhecida', ambiente: 'teste', cacheMs: 0 });

export function construirServidor(deps: DependenciasHttp): FastifyInstance {
  const app = Fastify({
    // Ligado → Pino com a MESMA máscara do logger de aplicação (`log.ts`), para
    // os dois lados do stdout falarem a mesma língua. O Fastify já carimba um
    // `reqId` por requisição — é ele que correlaciona as linhas de um request.
    logger: deps.logger ? opcoesLogFastify : false,
    trustProxy: deps.trustProxy ?? false,
    // C10.4 — Request ID rastreável. O padrão do Fastify é um contador que
    // REINICIA a cada boot ("req-1", "req-2"): no free tier, onde a instância
    // dorme e volta várias vezes por dia, dois erros distintos da mesma semana
    // recebem o mesmo id e a correlação vira ruído.
    //
    // Aqui o id do CLIENTE tem prioridade — é ele que o app mostra na tela e que
    // o usuário informa no suporte. Só é aceito depois de sanitizado: cabeçalho
    // é entrada não confiável e este valor vai direto para o log (ver
    // `shared/observabilidade/request-id.ts`).
    genReqId: (req) => sanitizarRequestId(req.headers[HEADER_REQUEST_ID]) ?? gerarRequestId(),
  });
  const limites = deps.limites ?? LIMITES_PADRAO;

  // `usuarioId` no request para o log do erro saber QUEM foi afetado. Só existe
  // do lado PRIVADO — as rotas anônimas (consulta/sync) nunca o preenchem, e é
  // assim que tem que ser (docs/04).
  app.decorateRequest('usuarioId', undefined);

  // Carimba a rota como `action` em toda linha daquela requisição. Usa a rota
  // COM template (`/ingestao/cupom/:id`), nunca a URL concreta — agrupa no
  // painel e evita que um id vire cardinalidade infinita de métrica.
  app.addHook('onRequest', (req, reply, done) => {
    req.log = req.log.child({ action: `http:${req.method} ${req.routeOptions?.url ?? req.url}` });
    // Devolve o id em TODA resposta, inclusive nas de sucesso. Só no erro seria
    // tarde: quando o usuário relata "ficou lento" ou "veio o preço errado" não
    // houve erro nenhum, e sem o id não há como achar aquela requisição.
    void reply.header(HEADER_REQUEST_ID, req.id);
    done();
  });

  // C10.4 — tempo de resposta por ROTA. `elapsedTime` é do Fastify e mede o
  // ciclo inteiro. A chave é o template da rota, nunca a URL concreta: com
  // `/cupom/:id` em URL crua, cada cupom viraria uma série de métrica própria.
  const metricasPerf = deps.metricasPerformance;
  if (metricasPerf) {
    app.addHook('onResponse', (req, reply, done) => {
      const rota = `${req.method} ${req.routeOptions?.url ?? 'desconhecida'}`;
      metricasPerf.observarHttp(rota, reply.elapsedTime, reply.statusCode);
      done();
    });
  }

  // C9.3.2 — Escolhe o limitador: Postgres (distribuído) ou memória (fallback).
  // Postgres permite múltiplas instâncias respeitarem o mesmo teto; memória vale
  // só para o processo atual (dev/testes em memória).
  const criarLimitador = (opcoes: typeof limites.ingestao) => {
    if (deps.supabaseClient) {
      return new LimitadorJanelaFixaPostgres(deps.supabaseClient, opcoes);
    }
    return new LimitadorJanelaFixa(opcoes);
  };

  // Consulta e sync compartilham o MESMO limitador: um teto único de "leitura
  // pública" por IP. Os privados têm DOIS tetos, em ordem: por IP antes de
  // autenticar (barato, segura flood anônimo) e por CONTA depois (o que vale).
  const limitadorConta = criarLimitador(limites.ingestao);
  const contaDoRequest = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string | undefined> => {
    const usuarioId = await deps.autenticacao.resolver(req.headers);
    if (!usuarioId) {
      await reply.code(401).send({ erro: 'Usuário não identificado.' });
      return undefined;
    }
    // Contexto para o resto da requisição: quem é, em toda linha daqui pra
    // frente. Lado privado apenas — ver `decorateRequest` acima.
    req.usuarioId = usuarioId;
    req.log = req.log.child({ usuarioId });
    if (!(await barrarPorConta(limitadorConta, usuarioId, reply))) return undefined;
    return usuarioId;
  };

  const ctx: ContextoRotas = {
    deps,
    metricas: deps.metricas ?? SEM_METRICAS,
    saude: deps.saude ?? semSondas(),
    guardaConta: guardaDeTaxa(criarLimitador(limites.conta)),
    guardaLeitura: guardaDeTaxa(criarLimitador(limites.leituraPublica)),
    guardaPrivadoIp: guardaDeTaxa(criarLimitador(limites.privadoIp)),
    guardaCuradoriaIp: guardaDeTaxa(criarLimitador(limites.curadoriaIp)),
    contaDoRequest,
  };

  // Sondas da plataforma — as únicas rotas sem gate algum (ver `rotas/saude.ts`).
  registrarRotasSaude(app, ctx);
  registrarRotasConta(app, ctx);
  registrarRotasIngestao(app, ctx);
  registrarRotasConsulta(app, ctx);
  registrarRotasContribuicao(app, ctx);
  registrarRotasAlertas(app, ctx);
  registrarRotasCuradoria(app, ctx);

  app.setErrorHandler(tratarErro);

  return app;
}
