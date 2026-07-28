/**
 * Tradução de erro de domínio → resposta HTTP.
 *
 * Regra: só erro PREVISTO vira 4xx com mensagem própria. Qualquer outra coisa é
 * 500 genérico + log `error` — porque significa bug, banco fora ou exceção não
 * mapeada, e alguém precisa olhar. A mensagem do 500 nunca carrega o erro
 * original: um erro do driver do Postgres pode trazer trecho de query, e query
 * aqui carrega `chave_acesso`.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import {
  ChaveAcessoInvalidaError,
  HtmlDesafioError,
  HtmlErroPortalError,
  LancamentoInvalidoError,
  PayloadQrInvalidoError,
} from '../erros';
import { sanitizarErro } from '../observabilidade/sanitizar';

export function tratarErro(erro: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  // C10.4 — o id vai em TODO corpo de erro, não só no 500. Um 400 recorrente que
  // o usuário não entende também precisa ser localizável no log, e o app só
  // consegue mostrar "código do erro" se ele vier no corpo (o cabeçalho não
  // sobrevive à travessia até a tela).
  const requestId = String(req.id);

  if (erro.validation) {
    return reply
      .code(400)
      .send({ erro: 'Requisição inválida.', detalhes: erro.validation, requestId });
  }
  if (
    erro instanceof PayloadQrInvalidoError ||
    erro instanceof ChaveAcessoInvalidaError ||
    erro instanceof LancamentoInvalidoError
  ) {
    return reply.code(400).send({ erro: erro.message, requestId });
  }
  // HTML ainda é a página de desafio (C2.6): não é falha do cupom — o app deve
  // reabrir o WebView e reenviar quando a nota tiver renderizado. 422. O
  // `codigo` distingue do erro de portal abaixo, que pede outra reação do app.
  if (erro instanceof HtmlDesafioError) {
    return reply.code(422).send({ erro: erro.message, codigo: 'desafio', requestId });
  }
  // Portal recusou a verificação (reCAPTCHA) e caiu na página de erro: também
  // 422 (transitório, cupom intacto), mas o app deve RECARREGAR a consulta
  // (token novo) em vez de seguir esperando nesta página, que é terminal.
  if (erro instanceof HtmlErroPortalError) {
    // É transitório e o app re-tenta sozinho, mas um PICO disto significa que o
    // reCAPTCHA endureceu — sinal de operação que antes não deixava rastro.
    req.log.warn(
      { action: 'portal.recusou', codigo: 'erro_portal' },
      'Portal recusou a verificação',
    );
    return reply.code(422).send({ erro: erro.message, codigo: 'erro_portal', requestId });
  }
  req.log.error(
    { action: 'http.erro_nao_tratado', erro: sanitizarErro(erro) },
    'Erro não tratado — respondendo 500',
  );
  // A mensagem segue genérica (ver nota no topo), mas agora acompanhada do id:
  // é o que transforma "Erro interno." num relato investigável.
  return reply.code(500).send({ erro: 'Erro interno.', requestId });
}
