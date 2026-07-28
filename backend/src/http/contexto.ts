/**
 * Contexto compartilhado pelos módulos de rota (`rotas/*.ts`).
 *
 * O `servidor.ts` monta este objeto uma vez — dependências injetadas, guardas de
 * taxa já construídos, porta única de autenticação — e cada módulo de rota o
 * recebe pronto. Assim as rotas ficam agrupadas por assunto sem que cada arquivo
 * precise reconstruir limitadores (o que multiplicaria os tetos por engano) nem
 * repetir a sequência autenticar → limitar por conta.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AutorizacaoCuradoria } from '../auth/curadoria';
import type { MonitorSaude } from '../observabilidade/saude';
import type { FonteMetricas } from '../observabilidade/telemetria';
import type { DependenciasHttp } from './dependencias';
import type { GuardaTaxa } from './rate-limit';

export interface ContextoRotas {
  deps: DependenciasHttp;
  metricas: FonteMetricas;
  /** Health check detalhado (C10.4) — fonte de `/saude` e `/saude/pronto`. */
  saude: MonitorSaude;
  /** Criação de conta anônima — por IP. */
  guardaConta: GuardaTaxa;
  /** Leitura pública (consulta + sync) — por IP. */
  guardaLeitura: GuardaTaxa;
  /** Endpoints privados — por IP, ANTES de autenticar. */
  guardaPrivadoIp: GuardaTaxa;
  /** Endpoints de curadoria — por IP (o token é a autorização, não o teto). */
  guardaCuradoriaIp: GuardaTaxa;
  /**
   * Porta única dos endpoints privados: autentica e SÓ ENTÃO aplica o teto por
   * conta. Responde 401/429 por conta própria; devolve `undefined` quando já
   * respondeu — o handler deve retornar sem fazer mais nada.
   */
  contaDoRequest(req: FastifyRequest, reply: FastifyReply): Promise<string | undefined>;
}

/**
 * Guarda de autorização da curadoria como função — 403 quando o token não bate.
 * Devolve `true` quando pode seguir.
 */
export function exigeCuradoria(
  autorizacao: AutorizacaoCuradoria,
  req: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (autorizacao.autorizado(req.headers as never)) return true;
  void reply.code(403).send({ erro: 'Acesso restrito à curadoria.' });
  return false;
}
