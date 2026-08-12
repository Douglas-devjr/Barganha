/**
 * Chave de acesso da NFC-e (44 dígitos) — extração e validação COMPARTILHADAS.
 *
 * POR QUE MORA EM `shared`: os dois lados dedupam pela chave, e precisam chegar
 * ao MESMO texto a partir do mesmo QR.
 *   • app     — índice único de `cupom_local.chave_acesso` (idempotência local,
 *               docs/05): impede o mesmo cupom virar dois cartões no histórico.
 *   • backend — `cupom (usuario_id, chave_acesso_hash)` único: 1 cupom = 1
 *               registro na conta, e o hash global do pool (C9.2.1).
 * Se cada lado extraísse a chave à sua maneira, um mesmo QR poderia render
 * chaves diferentes e os dedups discordariam: o aparelho abriria "cupom novo"
 * onde o servidor responde "já existe". Uma regra só, nos dois lados.
 *
 * NÃO É PARSING DA NOTA (decisão travada nº2). Nada aqui toca a SEFAZ nem lê
 * item, loja ou preço — só localiza o identificador que já vem escrito no
 * próprio QR. O parsing continua exclusivamente no backend, e a chave que vale
 * é sempre a que ele devolve na resposta da ingestão.
 *
 * Estrutura da chave (posições): cUF(2) AAMM(4) CNPJ(14) modelo(2) série(3)
 * número(9) tpEmis(1) cNF(8) cDV(1).
 *
 * A chave é dado PRIVADO (liga a nota a um CPF via SEFAZ); nunca vai ao pool
 * compartilhado (docs/04).
 */

/** Tamanho da chave de acesso da NFC-e. */
export const DIGITOS_CHAVE_ACESSO = 44;

/** Mantém apenas dígitos (o QR às vezes traz a chave com espaços/separadores). */
export function apenasDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

/**
 * Dígito verificador da chave (módulo 11 sobre os 43 primeiros dígitos,
 * pesos 2..9 cíclicos da direita para a esquerda).
 */
export function digitoVerificadorChave(chave43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

/**
 * `true` quando a entrada tem 44 dígitos E o dígito verificador confere.
 * Versão que NÃO lança — o backend usa `parseChaveAcesso` quando precisa do
 * erro tipado e da decomposição.
 */
export function chaveAcessoValida(entrada: string): boolean {
  const valor = apenasDigitos(entrada);
  if (valor.length !== DIGITOS_CHAVE_ACESSO) return false;
  return digitoVerificadorChave(valor.slice(0, 43)) === Number(valor[43]);
}

/** Localiza a primeira sequência de 44 dígitos no texto (fallback robusto). */
function primeiraChave44(texto: string): string | undefined {
  return texto.match(/\d{44}/)?.[0];
}

/**
 * Extrai a chave de acesso do payload do QR SEM validar o dígito verificador,
 * tentando, em ordem:
 *  1. parâmetro `p` da URL (primeiro segmento antes de `|`);
 *  2. parâmetro `chNFe`/`chave`;
 *  3. qualquer sequência de 44 dígitos no texto.
 *
 * Sem validação de DV de propósito: é o que permite ao backend distinguir
 * "não achei chave nenhuma" (`PayloadQrInvalidoError`) de "achei uma chave
 * quebrada" (`ChaveAcessoInvalidaError`). Quem quer a chave já conferida usa
 * `extrairChaveDoQr`.
 */
export function extrairChaveCruaDoQr(payload: string): string | undefined {
  const texto = payload.trim();

  try {
    const url = new URL(texto);
    const p = url.searchParams.get('p');
    if (p) {
      const candidato = apenasDigitos(p.split('|')[0] ?? '');
      if (candidato.length === DIGITOS_CHAVE_ACESSO) return candidato;
    }
    const ch = url.searchParams.get('chNFe') ?? url.searchParams.get('chave');
    if (ch && apenasDigitos(ch).length === DIGITOS_CHAVE_ACESSO) return apenasDigitos(ch);
  } catch {
    // Não é uma URL — segue para os fallbacks por texto.
  }

  // Payload pode ser só a chave (com ou sem separadores) ou um texto com ela.
  const soDigitos = apenasDigitos(texto);
  if (soDigitos.length === DIGITOS_CHAVE_ACESSO) return soDigitos;
  return primeiraChave44(texto);
}

/**
 * Chave de acesso do QR, já conferida (44 dígitos + DV). `undefined` quando o
 * payload não tem chave reconhecível ou a que tem está quebrada.
 *
 * É o que o APP usa na captura: melhor esforço para a idempotência local. Não
 * achar chave nunca bloqueia a captura — o cupom é gravado do mesmo jeito com o
 * QR cru, e o backend (a autoridade) decide se o payload presta.
 */
export function extrairChaveDoQr(payload: string): string | undefined {
  if (!payload || !payload.trim()) return undefined;
  const crua = extrairChaveCruaDoQr(payload);
  return crua && chaveAcessoValida(crua) ? crua : undefined;
}
