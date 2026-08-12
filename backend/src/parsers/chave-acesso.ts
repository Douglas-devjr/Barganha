/**
 * Chave de acesso da NFC-e (44 dígitos) — identidade da nota.
 *
 * Estrutura (posições): cUF(2) AAMM(4) CNPJ(14) modelo(2) série(3) número(9)
 * tpEmis(1) cNF(8) cDV(1). Daqui extraímos UF, CNPJ do emitente e modelo SEM
 * tocar a SEFAZ — útil para validar a ingestão e preencher o cupom cedo.
 *
 * A chave é dado PRIVADO (liga a nota a um CPF via SEFAZ); nunca vai ao pool
 * compartilhado (docs/04).
 */

import { apenasDigitos, digitoVerificadorChave, DIGITOS_CHAVE_ACESSO } from '@barganha/shared';

import { ChaveAcessoInvalidaError } from '../erros';
import { ufDeCuf } from './cuf';

// Reexporta a extração/validação que agora vive em `@barganha/shared` (o app
// precisa da MESMA regra para a idempotência local). Quem já importava daqui
// segue funcionando.
export { apenasDigitos, digitoVerificadorChave };

/** Modelo 65 = NFC-e. (55 = NF-e, fora do escopo da captura por QR.) */
export const MODELO_NFCE = '65';

export interface ChaveAcesso {
  /** A chave crua (44 dígitos). */
  valor: string;
  /** Código IBGE do estado (2 díg.). */
  cuf: string;
  /** UF derivada do `cUF` (ex.: "RJ", "SP"). */
  uf?: string;
  /** Ano/mês de emissão, "AAMM". */
  anoMes: string;
  /** CNPJ do emitente (14 díg.) — base da `loja`. */
  cnpj: string;
  /** Modelo do documento (65 = NFC-e). */
  modelo: string;
  serie: string;
  numero: string;
}

/**
 * Valida e decompõe a chave de acesso. Lança `ChaveAcessoInvalidaError` se o
 * tamanho, o formato ou o dígito verificador não baterem.
 */
export function parseChaveAcesso(entrada: string): ChaveAcesso {
  const valor = apenasDigitos(entrada);
  if (valor.length !== DIGITOS_CHAVE_ACESSO) {
    throw new ChaveAcessoInvalidaError(
      `Chave de acesso deve ter 44 dígitos (tem ${valor.length}).`,
    );
  }

  const dvEsperado = digitoVerificadorChave(valor.slice(0, 43));
  const dvInformado = Number(valor[43]);
  if (dvEsperado !== dvInformado) {
    throw new ChaveAcessoInvalidaError('Dígito verificador da chave de acesso inválido.');
  }

  const cuf = valor.slice(0, 2);
  return {
    valor,
    cuf,
    uf: ufDeCuf(cuf),
    anoMes: valor.slice(2, 6),
    cnpj: valor.slice(6, 20),
    modelo: valor.slice(20, 22),
    serie: valor.slice(22, 25),
    numero: valor.slice(25, 34),
  };
}
