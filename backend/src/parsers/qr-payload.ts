/**
 * Parse do payload do QR da NFC-e.
 *
 * O QR é uma URL que aponta para o portal de consulta da SEFAZ do estado.
 * O parâmetro `p` carrega campos separados por `|`, sendo o primeiro a chave
 * de acesso (chNFe). Ex. (online):
 *   https://www.fazenda.rj.gov.br/nfce/qrcode?p=33260612345...017|2|1|cId|hash
 *
 * Daqui tiramos a chave (logo a UF) e mantemos a URL para a busca na SEFAZ.
 * Tolerante a variações de layout entre estados (por isso vários fallbacks).
 */

import { urlConsultaConfiavel } from '@barganha/shared';

import { PayloadQrInvalidoError } from '../erros';
import { apenasDigitos, parseChaveAcesso, type ChaveAcesso } from './chave-acesso';

export interface QrNfce {
  /** Chave de acesso já validada e decomposta. */
  chave: ChaveAcesso;
  /** UF do emitente (conveniência; espelha `chave.uf`). */
  uf?: string;
  /**
   * URL de consulta na SEFAZ — presente só quando o payload é uma URL de um
   * portal público (`urlConsultaConfiavel`). Ausente tanto no QR que traz só a
   * chave quanto no payload que aponta para um host de terceiro: é este campo
   * que o `ClienteSefazHttp` busca, e ele nunca pode carregar um endereço
   * escolhido por quem imprimiu o QR (SSRF).
   */
  urlConsulta?: string;
  /** Payload original cru (o que o app capturou). */
  payloadCru: string;
}

/** Localiza a primeira sequência de 44 dígitos no texto (fallback robusto). */
function primeiraChave44(texto: string): string | undefined {
  return texto.match(/\d{44}/)?.[0];
}

/**
 * Extrai a chave de acesso do payload do QR, tentando, em ordem:
 *  1. parâmetro `p` da URL (primeiro segmento antes de `|`);
 *  2. parâmetro `chNFe`/`chave`;
 *  3. qualquer sequência de 44 dígitos no texto.
 */
function extrairChaveCrua(payload: string): string | undefined {
  const texto = payload.trim();

  try {
    const url = new URL(texto);
    const p = url.searchParams.get('p');
    if (p) {
      const candidato = apenasDigitos(p.split('|')[0] ?? '');
      if (candidato.length === 44) return candidato;
    }
    const ch = url.searchParams.get('chNFe') ?? url.searchParams.get('chave');
    if (ch && apenasDigitos(ch).length === 44) return apenasDigitos(ch);
  } catch {
    // Não é uma URL — segue para os fallbacks por texto.
  }

  // Payload pode ser só a chave (com ou sem separadores) ou um texto com ela.
  const soDigitos = apenasDigitos(texto);
  if (soDigitos.length === 44) return soDigitos;
  return primeiraChave44(texto);
}

/**
 * Converte o payload cru do QR num `QrNfce` com a chave validada.
 * Lança `PayloadQrInvalidoError` se não houver chave; `ChaveAcessoInvalidaError`
 * (de `parseChaveAcesso`) se a chave encontrada for inválida.
 */
export function parseQrNfce(payload: string): QrNfce {
  if (!payload || !payload.trim()) {
    throw new PayloadQrInvalidoError('Payload do QR vazio.');
  }

  const chaveCrua = extrairChaveCrua(payload);
  if (!chaveCrua) {
    throw new PayloadQrInvalidoError('Não foi possível localizar a chave de acesso no QR.');
  }

  const chave = parseChaveAcesso(chaveCrua);

  // A chave já saiu do payload acima — o que se decide aqui é só se vale
  // BUSCAR nesta URL. Host de terceiro vira `undefined`: o cupom segue com a
  // chave (e o QR cru guardado), mas ninguém faz requisição para o endereço que
  // o atacante escolheu. Ver `urlConsultaConfiavel`.
  //
  // A URL também sai PROMOVIDA a https. O backend consultava no esquema que o
  // QR trouxesse, e boa parte dos emissores ainda grava `http://` — o que põe a
  // chave de acesso (dado do mundo privado, docs/04) em texto puro na rede.
  const urlConsulta = urlConsultaConfiavel(payload) ?? undefined;

  return { chave, uf: chave.uf, urlConsulta, payloadCru: payload.trim() };
}
