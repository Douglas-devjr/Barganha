import { describe, expect, it } from 'vitest';

import { PayloadQrInvalidoError } from '../erros';
import { parseQrNfce } from './qr-payload';

const CHAVE_RJ = '33260612345678000199650010000000011000000016';
const URL_RJ = `https://www.fazenda.rj.gov.br/nfce/qrcode?p=${CHAVE_RJ}|2|1|1|ABCDEF0123456789`;

describe('parseQrNfce (C2.1)', () => {
  it('extrai a chave e a UF do parâmetro `p` da URL', () => {
    const qr = parseQrNfce(URL_RJ);
    expect(qr.chave.valor).toBe(CHAVE_RJ);
    expect(qr.uf).toBe('RJ');
    expect(qr.urlConsulta).toContain('fazenda.rj.gov.br');
    expect(qr.payloadCru).toBe(URL_RJ);
  });

  it('aceita o payload sendo só a chave (sem URL)', () => {
    const qr = parseQrNfce(CHAVE_RJ);
    expect(qr.chave.uf).toBe('RJ');
    expect(qr.urlConsulta).toBeUndefined();
  });

  it('encontra a chave mesmo embutida em texto', () => {
    const qr = parseQrNfce(`chave: ${CHAVE_RJ} fim`);
    expect(qr.chave.valor).toBe(CHAVE_RJ);
  });

  it('rejeita payload vazio', () => {
    expect(() => parseQrNfce('   ')).toThrow(PayloadQrInvalidoError);
  });

  it('rejeita payload sem chave de 44 dígitos', () => {
    expect(() => parseQrNfce('https://exemplo.com/qrcode?p=123|2|1')).toThrow(
      PayloadQrInvalidoError,
    );
  });
});
