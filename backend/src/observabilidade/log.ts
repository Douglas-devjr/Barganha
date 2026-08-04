/**
 * C10.2 — Logger estruturado único do backend (JSON, uma linha por evento).
 *
 * POR QUE PINO E NÃO WINSTON: o Fastify JÁ usa Pino internamente (é dependência
 * direta dele). Adotar outra biblioteca significaria manter DUAS pilhas de log no
 * mesmo processo — o Fastify continuaria emitindo Pino de qualquer jeito, e o
 * stdout teria duas gramáticas misturadas. Além disso `fatal` é nível NATIVO do
 * Pino; os níveis padrão do Winston não têm `fatal`. Zero dependência nova.
 *
 * POLÍTICA DE NÍVEIS (o que faz o alerta ser útil em vez de ruído):
 *  • `info`  — marco de negócio: cupom processado, job concluído, boot.
 *  • `warn`  — degradação COM recuperação automática: retentativa da fila, portal
 *              recusando, delta sync que a próxima rodada refaz.
 *  • `error` — exige ação humana e o usuário foi afetado: falha permanente de
 *              parser, recálculo perdido, telemetria não persistindo.
 *  • `fatal` — o processo não serve mais: config ausente, `listen` falhou.
 *
 * A regra que evita o alerta ruidoso: erro TRANSITÓRIO que a fila vai reprocessar
 * é `warn`, não `error`. Se toda oscilação de portal da SEFAZ virasse `error`, o
 * alerta seria desligado na primeira semana.
 *
 * LGPD (docs/04): duas camadas de proteção, porque nenhuma sozinha basta.
 *  1. `redact` — campos NOMEADOS (token, senha, header de autorização).
 *  2. `sanitizarErro`/`redigirTexto` — dado pessoal embutido em TEXTO LIVRE, que
 *     o `redact` não enxerga. Ver `sanitizar.ts`.
 *
 * PROIBIDO: logar `usuarioId` no caminho do POOL (`observacao_preco`). Ali o
 * vínculo usuário↔produto é justamente o que a decisão travada nº3 proíbe — um
 * log com os dois lados reconstruiria por texto o que o banco se recusa a
 * guardar. No lado privado (ingestão, conta) o vínculo já existe e pode ser logado.
 */

import { pino, type Logger } from 'pino';

/**
 * Campos que nunca podem aparecer, em qualquer profundidade razoável.
 *
 * Exportado para ser TESTÁVEL: a sintaxe de `paths` do Pino falha em SILÊNCIO
 * quando o caminho está errado (o campo simplesmente sai em claro, sem erro
 * nenhum). Um controle de privacidade que falha calado precisa de teste — ver
 * `log.test.ts`.
 */
export const CAMPOS_REDIGIDOS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'token',
  '*.token',
  '*.senha',
  '*.password',
  '*.access_token',
  '*.refresh_token',
  '*.apikey',
  '*.serviceRoleKey',
  '*.supabaseServiceRoleKey',
  '*.cpf',
  '*.chaveAcesso',
  '*.qrPayload',
  '*.html',
  // Rede de segurança do canal de e-mail transacional (docs/04, C9.2): mesmo
  // que um `log.warn({ conta })` futuro passe o objeto inteiro por engano, o
  // Pino redige estes campos antes de sair. O caminho normal (email-
  // transacional.ts) já não loga nenhum deles — isto é defesa em profundidade.
  '*.email',
  '*.destinatario',
  '*.corpoTexto',
  '*.apiKey',
  '*.emailApiKey',
];

const ehTeste = process.env.NODE_ENV === 'test';

/**
 * Logger raiz. Em teste fica silencioso: o log é efeito colateral e não deve
 * poluir a saída da suíte (os testes de máscara verificam a redação diretamente).
 */
export const log: Logger = pino({
  level: process.env.LOG_LEVEL ?? (ehTeste ? 'silent' : 'info'),
  // `level: "warn"` em vez de `level: 40` — coletor nenhum precisa de tabela.
  formatters: { level: (label) => ({ level: label }) },
  redact: { paths: CAMPOS_REDIGIDOS, censor: '[REDIGIDO]' },
  base: { servico: 'barganha-backend' },
});

/**
 * Opções do logger do Fastify. Compartilha a MESMA configuração (e portanto a
 * mesma máscara) do logger de aplicação, para os dois lados do stdout falarem a
 * mesma língua.
 *
 * O serializer de `req` é explícito de propósito: o padrão do Fastify não inclui
 * headers, e queremos que continue assim mesmo que alguém suba o nível para
 * `debug` — é o header `authorization` que estaria ali.
 */
export const opcoesLogFastify = {
  level: process.env.LOG_LEVEL ?? (ehTeste ? 'silent' : 'info'),
  formatters: { level: (label: string) => ({ level: label }) },
  redact: { paths: CAMPOS_REDIGIDOS, censor: '[REDIGIDO]' },
  base: { servico: 'barganha-backend' },
  serializers: {
    req: (req: { method: string; url: string; ip?: string }) => ({
      metodo: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({ status: res.statusCode }),
  },
};

/**
 * Logger de um escopo de trabalho assíncrono (fila, job, worker). O `cupomId` é
 * a CHAVE DE CORRELAÇÃO natural do sistema: ele atravessa ingestão → fila →
 * parsing → publicação no pool, que são três fronteiras assíncronas onde o
 * `reqId` do Fastify já morreu.
 */
export function logDeCupom(cupomId: string, uf?: string): Logger {
  return log.child({ cupomId, ...(uf ? { uf } : {}) });
}

/** Logger de um job em lote — `action` fixa para filtrar a execução inteira. */
export function logDeJob(job: string): Logger {
  return log.child({ action: `job:${job}` });
}
