/**
 * C2.6 — Normalização da URL de consulta da NFC-e antes de qualquer requisição.
 *
 * O QR impresso no cupom carrega a URL do portal da SEFAZ tal como o emissor a
 * gravou — e boa parte dos estados ainda grava `http://`. Isso quebra de duas
 * formas:
 *
 *  • FUNCIONALMENTE: portais que já migraram para TLS não apenas redirecionam,
 *    eles FECHARAM a porta 80. O RJ (`consultadfe.fazenda.rj.gov.br`) recusa a
 *    conexão — o WebView morre em `net::ERR_CONNECTION_REFUSED` antes de existir
 *    qualquer camada HTTP para redirecionar.
 *  • EM PRIVACIDADE: a query string dessa URL contém a CHAVE DE ACESSO (44
 *    dígitos), que é dado do mundo privado (docs/04). Buscá-la em texto puro a
 *    expõe a qualquer um no mesmo Wi-Fi.
 *
 * Por isso a promoção para `https` é incondicional, e não uma lista de hosts
 * conhecidos: não existe caso em que valha consultar a SEFAZ em claro. O
 * `qrPayload` GRAVADO continua sendo o cru, exatamente como lido (decisão
 * travada nº2) — a normalização acontece só na hora de acessar a rede.
 */
export function urlConsultaSegura(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}
