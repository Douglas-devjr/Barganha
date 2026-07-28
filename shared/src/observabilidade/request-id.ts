/**
 * C10.4 — Request ID: a única corda que liga "o app deu erro na minha tela" à
 * linha de log que explica o porquê.
 *
 * Vive no `shared` porque as DUAS pontas precisam da MESMA regra. O app gera o
 * id e o envia; o backend aceita o recebido em vez de inventar outro, e o
 * devolve no cabeçalho e no corpo do erro. Se cada lado tivesse a sua regra, o
 * id do app e o do servidor divergiriam e a correlação — a razão de tudo isto
 * existir — se perderia exatamente no caso de erro.
 *
 * POR QUE SANITIZAR O QUE CHEGA (e não confiar): o valor vem de um cabeçalho
 * HTTP, ou seja, do cliente. Ele acaba dentro de uma linha de log estruturado.
 * Sem filtro, alguém manda um "id" com quebra de linha e JSON dentro e passa a
 * FORJAR eventos de log — o coletor lê como se fossem duas linhas legítimas.
 * Por isso o alfabeto é fechado e o tamanho tem teto: o que não obedecer é
 * descartado e o servidor gera um id próprio.
 *
 * O gerador NÃO é criptográfico de propósito. Este id não autoriza nada; ele só
 * precisa não colidir entre requisições próximas, e `crypto.randomUUID` não
 * existe no runtime do React Native sem polyfill.
 */

/** Cabeçalho, em minúsculas — é assim que o Fastify entrega os headers. */
export const HEADER_REQUEST_ID = 'x-request-id';

/** Teto de tamanho: id é para correlacionar, não para carregar carga útil. */
const TAMANHO_MAXIMO = 64;

/** Alfabeto seguro para log estruturado — sem espaço, aspas ou quebra de linha. */
const FORMATO_VALIDO = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Aceita o id que veio do cliente, ou `undefined` se ele não serve. Devolver
 * `undefined` é o caminho seguro: quem chama gera um id novo.
 */
export function sanitizarRequestId(bruto: unknown): string | undefined {
  if (typeof bruto !== 'string') return undefined;
  const limpo = bruto.trim();
  if (!FORMATO_VALIDO.test(limpo)) return undefined;
  return limpo.slice(0, TAMANHO_MAXIMO);
}

/**
 * Id novo, no formato `<base36 do tempo>-<aleatório>`. O prefixo temporal deixa
 * os ids de uma sessão ordenáveis a olho nu, o que ajuda quem lê o log bruto.
 */
export function gerarRequestId(): string {
  const tempo = Date.now().toString(36);
  const aleatorio = Math.random().toString(36).slice(2, 10);
  return `${tempo}-${aleatorio}`;
}
