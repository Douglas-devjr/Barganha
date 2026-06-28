/**
 * Mapa do código `cUF` (IBGE) → sigla da UF. O `cUF` são os 2 primeiros
 * dígitos da chave de acesso da NFC-e e identificam o estado emissor — é a
 * fonte canônica da UF (mais confiável que o host do portal no QR).
 */

/** cUF (IBGE) → UF. Cobre as 27 unidades federativas. */
const CUF_PARA_UF: Readonly<Record<string, string>> = {
  '11': 'RO',
  '12': 'AC',
  '13': 'AM',
  '14': 'RR',
  '15': 'PA',
  '16': 'AP',
  '17': 'TO',
  '21': 'MA',
  '22': 'PI',
  '23': 'CE',
  '24': 'RN',
  '25': 'PB',
  '26': 'PE',
  '27': 'AL',
  '28': 'SE',
  '29': 'BA',
  '31': 'MG',
  '32': 'ES',
  '33': 'RJ',
  '35': 'SP',
  '41': 'PR',
  '42': 'SC',
  '43': 'RS',
  '50': 'MS',
  '51': 'MT',
  '52': 'GO',
  '53': 'DF',
};

/** Converte o `cUF` (2 dígitos) na sigla da UF, ou `undefined` se desconhecido. */
export function ufDeCuf(cuf: string): string | undefined {
  return CUF_PARA_UF[cuf];
}
