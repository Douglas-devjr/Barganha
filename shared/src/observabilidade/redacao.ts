/**
 * C10.2 — Redação de dado pessoal/credencial em TEXTO LIVRE, para log.
 *
 * Vive em `shared` de propósito: app e backend precisam da MESMA regra. Um
 * controle de privacidade duplicado em dois workspaces diverge — e quando
 * divergir, o lado esquecido vira o vazamento.
 *
 * ESTA CAMADA É COMPLEMENTAR ao `redact` do Pino (backend). O `redact` protege
 * caminhos NOMEADOS (`req.headers.authorization`); ele não enxerga um CPF
 * embutido no meio de uma mensagem de erro. É esse o caso que aqui se cobre —
 * e é justamente como o risco aparece no Barganha: mensagem de erro de parser
 * carregando o pedaço do HTML da SEFAZ que um seletor derrapado capturou.
 *
 * O que é redigido e o que NÃO é (decisão deliberada):
 *  • REDIGIDO — CPF, chave de acesso (44 díg.), JWT/Bearer, e-mail. Dado pessoal
 *    ou credencial; nada disso ajuda a diagnosticar nada.
 *  • MANTIDO — CNPJ da loja. É dado de EMPRESA, já persistido por projeto (a geo
 *    é pela LOJA, decisão travada nº4) e é o que permite diagnosticar a
 *    divergência nota × chave de acesso. Redigi-lo cegaria o diagnóstico sem
 *    ganho nenhum de privacidade.
 */

/** Teto do texto de erro. Log não é lugar de despejar HTML de portal. */
const MAX_MENSAGEM = 300;

const REDIGIDO = '[REDIGIDO]';

/**
 * Ordem IMPORTA: a chave de acesso (44 dígitos) contém sequências que também
 * casariam como CPF, então ela é consumida primeiro.
 */
const PADROES: ReadonlyArray<readonly [RegExp, string]> = [
  // JWT (três blocos base64url) — pega o token mesmo sem o prefixo "Bearer".
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, `${REDIGIDO}(jwt)`],
  // "Bearer <...>" / "Basic <...>".
  [/\b(Bearer|Basic)\s+[\w\-._~+/=]+/gi, `$1 ${REDIGIDO}`],
  // Chave de acesso da NFC-e: 44 dígitos.
  [/\b\d{44}\b/g, `${REDIGIDO}(chave)`],
  // CPF formatado (000.000.000-00) e 11 dígitos soltos.
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, `${REDIGIDO}(cpf)`],
  [/\b\d{11}\b/g, `${REDIGIDO}(cpf?)`],
  // E-mail.
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, `${REDIGIDO}(email)`],
];

/** Redige dado pessoal/credencial de um texto livre e o trunca. */
export function redigirTexto(texto: string): string {
  let saida = texto;
  for (const [padrao, substituto] of PADROES) {
    saida = saida.replace(padrao, substituto);
  }
  return saida.length > MAX_MENSAGEM ? `${saida.slice(0, MAX_MENSAGEM)}…[truncado]` : saida;
}

/** Forma segura de um erro, pronta para virar campo de log. */
export interface ErroSanitizado {
  /** Nome da classe do erro (`FalhaParserSefazError`) — o que se agrupa/alerta. */
  tipo: string;
  /** Mensagem já redigida e truncada. */
  mensagem: string;
}

/**
 * Converte qualquer `unknown` capturado num objeto seguro para log.
 *
 * A pilha (`stack`) fica de fora de propósito: não agrega no diagnóstico destes
 * erros (são de domínio, com mensagem descritiva) e é o lugar clássico onde
 * argumentos com dado sensível vazam para o log.
 */
export function sanitizarErro(erro: unknown): ErroSanitizado {
  if (erro instanceof Error) {
    return { tipo: erro.name, mensagem: redigirTexto(erro.message) };
  }
  return { tipo: 'DesconhecidoError', mensagem: redigirTexto(String(erro)) };
}
