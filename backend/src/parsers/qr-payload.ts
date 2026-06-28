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

import { PayloadQrInvalidoError } from '../erros';
import { apenasDigitos, parseChaveAcesso, type ChaveAcesso } from './chave-acesso';

export interface QrNfce {
  /** Chave de acesso já validada e decomposta. */
  chave: ChaveAcesso;
  /** UF do emitente (conveniência; espelha `chave.uf`). */
  uf?: string;
  /** URL de consulta na SEFAZ, quando o payload é uma URL. */
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

  let urlConsulta: string | undefined;
  try {
    urlConsulta = new URL(payload.trim()).toString();
  } catch {
    urlConsulta = undefined;
  }

  return { chave, uf: chave.uf, urlConsulta, payloadCru: payload.trim() };
}
