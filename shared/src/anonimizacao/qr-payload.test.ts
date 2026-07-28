import { describe, expect, it } from 'vitest';

import { qrPayloadTemPii, sanearQrPayload } from './qr-payload';

const CHAVE = '33260612345678000199650010000000011000000016';
const CPF = '12345678909';

/** QR v1 online: cDest é o 4º campo. */
const V1 = `https://www.fazenda.rj.gov.br/nfce/qrcode?p=${CHAVE}|1|1|${CPF}|2026-07-01T10:00:00-03:00|150.00|18.00|abc123|000001|hash`;
/** QR v2 online (atual): 5 campos, sem cDest em lugar nenhum. */
const V2 = `https://www.fazenda.rj.gov.br/nfce/qrcode?p=${CHAVE}|2|1|000001|d4f5a6b7`;

describe('sanearQrPayload', () => {
  it('remove o CPF do consumidor do QR versão 1', () => {
    const saneado = sanearQrPayload(V1);
    expect(saneado).not.toContain(CPF);
    expect(saneado).toContain(`p=${CHAVE}|1|1||2026-07-01`);
  });

  it('preserva a chave de acesso e os demais campos', () => {
    const saneado = sanearQrPayload(V1);
    expect(saneado).toContain(CHAVE);
    expect(saneado).toContain('150.00');
    expect(saneado).toContain('hash');
    // O número de campos não muda — só o conteúdo do 4º sai.
    expect(saneado.split('|')).toHaveLength(V1.split('|').length);
  });

  it('não toca no QR versão 2 (não tem cDest) — byte a byte igual', () => {
    // Crítico: v2 continua sendo consultada na SEFAZ com o payload guardado.
    expect(sanearQrPayload(V2)).toBe(V2);
  });

  it('devolve intocado o payload que é só a chave', () => {
    expect(sanearQrPayload(CHAVE)).toBe(CHAVE);
  });

  it('trata o separador percent-encoded', () => {
    const encodado = `https://portal/qr?p=${CHAVE}%7C1%7C1%7C${CPF}%7C2026-07-01%7C150.00%7C18%7Cx%7C1%7Ch`;
    const saneado = sanearQrPayload(encodado);
    expect(saneado).not.toContain(CPF);
    expect(saneado).toContain(`%7C1%7C1%7C%7C2026-07-01`);
  });

  it('esvazia cDest/cpf quando vêm como parâmetro próprio', () => {
    const url = `https://portal/qr?chNFe=${CHAVE}&cDest=${CPF}&tpAmb=1`;
    const saneado = sanearQrPayload(url);
    expect(saneado).not.toContain(CPF);
    expect(saneado).toContain(`chNFe=${CHAVE}`);
    expect(saneado).toContain('tpAmb=1');
  });

  it('é idempotente', () => {
    const uma = sanearQrPayload(V1);
    expect(sanearQrPayload(uma)).toBe(uma);
  });

  it('não quebra em v1 sem destinatário (campo já vazio)', () => {
    const semCpf = V1.replace(`|${CPF}|`, '||');
    expect(sanearQrPayload(semCpf)).toBe(semCpf);
  });

  it('não mexe em payload truncado (menos campos que a v1)', () => {
    const curto = `https://portal/qr?p=${CHAVE}|1|1`;
    expect(sanearQrPayload(curto)).toBe(curto);
  });
});

describe('qrPayloadTemPii', () => {
  it('acusa a v1 com CPF e absolve a v2', () => {
    expect(qrPayloadTemPii(V1)).toBe(true);
    expect(qrPayloadTemPii(V2)).toBe(false);
  });
});
