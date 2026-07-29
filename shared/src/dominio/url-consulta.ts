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

/**
 * Sufixo dos domínios do governo brasileiro. É o piso de confiança desta camada:
 * `gov.br` é registrável APENAS por órgão público (registro.br exige CNPJ de
 * ente governamental), então um atacante não consegue um host que passe aqui.
 */
const SUFIXO_GOV_BR = '.gov.br';

/**
 * C2.6 — O payload do QR é ENTRADA NÃO CONFIÁVEL: qualquer pessoa imprime um QR
 * e cola na gôndola. Antes de ele virar uma navegação (WebView do app) ou uma
 * requisição (busca do backend), o host precisa ser de um portal público.
 *
 * Sem esta porta, o mesmo payload abre duas brechas:
 *  • APP — o site do atacante carrega DENTRO do app, em tela cheia e sem barra
 *    de endereço, sob o título "Confirme sua nota": phishing em condições ideais
 *    para pedir a senha do Barganha ou imitar a tela do Google.
 *  • BACKEND — `fetch` numa URL escolhida pelo usuário é SSRF: `http://10.0.0.5`
 *    ou o endereço de metadados da nuvem viram um scanner da rede interna
 *    rodando a partir do servidor.
 *
 * A regra é o SUFIXO `.gov.br`, e não uma lista de hosts por UF, de propósito:
 * são 27 portais que mudam de endereço sem aviso (o RJ sozinho já usa dois:
 * `www.fazenda.rj.gov.br` e `consultadfe.fazenda.rj.gov.br`), e o app guarda o
 * QR cru de QUALQUER estado desde o dia 1 para processamento retroativo
 * (decisão travada nº2). Uma lista fixa quebraria captura legítima a cada
 * migração de portal — e não fecharia nada a mais: o que o atacante não tem é
 * um domínio do governo.
 *
 * Devolve a URL PROMOVIDA a https (pronta para uso) ou `null` quando o payload
 * não é uma URL de consulta confiável — incluindo o caso normal do QR que traz
 * só a chave de acesso, sem URL nenhuma.
 */
export function urlConsultaConfiavel(payload: string): string | null {
  const promovida = urlConsultaSegura(payload.trim());

  let url: URL;
  try {
    url = new URL(promovida);
  } catch {
    return null; // Não é URL (QR só com a chave) — não há o que abrir nem buscar.
  }

  // Só https. Barra de saída `file:`, `data:` e `javascript:` — este valor vira
  // navegação num WebView com JavaScript ligado.
  if (url.protocol !== 'https:') return null;

  // Credenciais embutidas jamais aparecem numa URL da SEFAZ, e são o truque
  // clássico para o humano ler o host errado: `https://…rj.gov.br@atacante.com`
  // é um endereço do ATACANTE. Recusamos em vez de confiar na leitura do host.
  if (url.username || url.password) return null;

  // `hostname` já vem minúsculo e sem a porta. O ponto final opcional do FQDN
  // (`fazenda.rj.gov.br.`) é o mesmo host e precisa cair na mesma regra.
  const host = url.hostname.replace(/\.$/, '');
  if (!host.endsWith(SUFIXO_GOV_BR)) return null;

  // Devolve a string PROMOVIDA, não `url.toString()`: o round-trip pelo `URL`
  // percent-encoda os `|` que separam os campos do parâmetro `p`, e o fluxo do
  // RJ é frágil demais para mudar o byte que vai ao portal (ver o teste que
  // trava a query intacta).
  return promovida;
}
