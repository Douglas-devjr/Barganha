/**
 * Saneamento do QR cru — remove o CPF do consumidor do payload guardado.
 *
 * POR QUE EXISTE: os parsers de estado nunca extraem o CPF do HTML da nota
 * (docs/04, decisão travada nº3), mas o QR **em si** pode carregá-lo. A
 * especificação ANTIGA do QR Code da NFC-e (versão 1) tem o campo `cDest` — o
 * CPF/CNPJ do destinatário — na 4ª posição do parâmetro `p`:
 *
 *   p=chNFe|nVersao|tpAmb|cDest|dhEmi|vNF|vICMS|digVal|cIdToken|cHashQRCode
 *                          ^^^^^ CPF de quem pediu a nota no CPF
 *
 * Como o payload é guardado CRU desde o dia 1 (decisão travada nº2), o CPF
 * entrava no banco pela porta dos fundos. A versão 2 (atual) não tem o campo, e
 * para ela isto aqui é no-op.
 *
 * QUANDO CHAMAR: **só depois** de o cupom chegar a `processado`. Em v1 o
 * `cHashQRCode` é calculado sobre a cadeia que INCLUI o `cDest`; saneado antes,
 * o portal da SEFAZ rejeita a consulta e o reprocessamento retroativo morre.
 * Cupom em `qr_capturado` ou `falha` ainda vai ser consultado — não sanear.
 *
 * COMO: cirurgia de texto, não round-trip de `URL`. Reserializar reescaparia o
 * `|` para `%7C` e mudaria um payload que não tinha nada a sanear — e é
 * exatamente esse payload que precisa continuar byte a byte igual para a
 * consulta na SEFAZ funcionar. Sem nada a remover, a entrada volta intocada.
 */

/** Separador dos campos de `p`: literal ou percent-encoded, conforme o portal. */
const SEPARADOR = /(%7C|\|)/i;

/** Parâmetros de query que carregam PII por nome próprio (fora do `p`). */
const PARAM_PII = /([?&])(cDest|cpf)=[^&#]*/gi;

/**
 * Zera o 4º campo (`cDest`) quando o payload é da versão 1. `partes` vem do
 * split COM captura do separador: campo `i` mora em `partes[i * 2]`.
 */
function sanearCamposP(valor: string): string {
  const partes = valor.split(SEPARADOR);
  // Menos de 4 campos = 7 elementos (4 campos + 3 separadores): não é v1 online.
  if (partes.length < 7) return valor;
  // `nVersao` é o 2º campo. Só a v1 posiciona um CPF aqui.
  if (partes[2] !== '1') return valor;
  // Nota sem destinatário já vem com o campo vazio — nada a fazer.
  if (!partes[6]) return valor;
  partes[6] = '';
  return partes.join('');
}

/**
 * Devolve o payload sem o CPF do consumidor. Idempotente: sanear duas vezes dá
 * o mesmo resultado. Payload sem PII volta EXATAMENTE como entrou.
 */
export function sanearQrPayload(payload: string): string {
  let saneado = payload.replace(PARAM_PII, '$1$2=');

  const p = /([?&]p=)([^&#]*)/i.exec(saneado);
  if (p) {
    const valorSaneado = sanearCamposP(p[2]!);
    if (valorSaneado !== p[2]) {
      saneado =
        saneado.slice(0, p.index) + p[1] + valorSaneado + saneado.slice(p.index + p[0].length);
    }
  } else if (!saneado.includes('?')) {
    // Payload que é só a cadeia de campos, sem URL em volta (alguns portais).
    saneado = sanearCamposP(saneado);
  }

  return saneado;
}

/** `true` quando `sanearQrPayload` teria algo a remover. Uso: testes e auditoria. */
export function qrPayloadTemPii(payload: string): boolean {
  return sanearQrPayload(payload) !== payload;
}
