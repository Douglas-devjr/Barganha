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
 * A pilha (`stack`) fica de fora de propósito: erro de DOMÍNIO já diz tudo na
 * mensagem ("UF não suportada: MG") e a pilha só acrescentaria ruído — quem lê
 * o alerta quer agrupar por tipo, não navegar frames. Para o erro INESPERADO,
 * onde a pilha é a única pista, use `sanitizarErroInesperado`.
 */
export function sanitizarErro(erro: unknown): ErroSanitizado {
  if (erro instanceof Error) {
    return { tipo: erro.name, mensagem: redigirTexto(erro.message) };
  }
  return { tipo: 'DesconhecidoError', mensagem: redigirTexto(String(erro)) };
}

/** Frames guardados por erro. O bastante para achar a origem, sem virar parede. */
const MAX_FRAMES = 12;

/** Profundidade da cadeia de `cause` — evita ciclo e log gigante. */
const MAX_CAUSAS = 3;

export interface ErroInesperado extends ErroSanitizado {
  /**
   * Frames já redigidos, um por item — array e não string única para o coletor
   * conseguir indexar e o painel renderizar sem reparsear texto.
   */
  pilha: string[];
  /** Cadeia de `Error.cause`, sanitizada igual. É onde mora a causa REAL. */
  causa?: ErroInesperado;
}

/**
 * C10.4 — Erro INESPERADO (o 500, o `fatal` de boot, o job que explodiu) com a
 * pilha preservada.
 *
 * Aqui a pilha é obrigatória: um erro não previsto não tem mensagem descritiva
 * escrita por nós — tipicamente é um `TypeError: Cannot read properties of
 * undefined`, que sem os frames não localiza nada. Era o buraco de debug do
 * backend: todo 500 registrava tipo e mensagem e nada sobre ONDE aconteceu.
 *
 * O que a pilha atravessa antes de virar log:
 *  1. A primeira linha é DESCARTADA — ela repete "Tipo: mensagem", que já vai
 *     nos campos próprios, e é o pedaço do `stack` que pode conter HTML de
 *     portal ou dado pessoal vindo da mensagem.
 *  2. Frames de `node_modules` e de módulos internos do Node saem: ruído que
 *     empurra os nossos frames para fora do teto.
 *  3. Cada frame sobrevivente passa por `redigirTexto`, porque caminho de
 *     arquivo em máquina de desenvolvimento pode carregar nome/e-mail no
 *     diretório de usuário.
 */
export function sanitizarErroInesperado(erro: unknown, profundidade = 0): ErroInesperado {
  const base = sanitizarErro(erro);
  if (!(erro instanceof Error)) return { ...base, pilha: [] };

  const causa =
    profundidade < MAX_CAUSAS && erro.cause != null
      ? sanitizarErroInesperado(erro.cause, profundidade + 1)
      : undefined;

  return {
    ...base,
    pilha: extrairFrames(erro.stack),
    ...(causa ? { causa } : {}),
  };
}

/** `true` para frame de dependência ou do próprio Node — ruído, não pista. */
const ehRuido = (frame: string): boolean =>
  frame.includes('node_modules') || frame.includes('(node:') || frame.includes('at node:');

function extrairFrames(stack: string | undefined): string[] {
  if (!stack) return [];

  const linhas = stack
    .split('\n')
    .map((l) => l.trim())
    // Só linhas de frame: descarta de uma vez a primeira linha (tipo + mensagem)
    // e qualquer texto que algum runtime enfie no meio.
    .filter((l) => l.startsWith('at '));

  const nossos = linhas.filter((l) => !ehRuido(l));
  // Erro lançado do fundo de uma dependência não tem frame nosso nenhum. Ficar
  // com a lista vazia seria pior que o ruído — guarda os primeiros como pista.
  const escolhidos = nossos.length > 0 ? nossos : linhas.slice(0, 3);

  return escolhidos.slice(0, MAX_FRAMES).map(redigirTexto);
}
