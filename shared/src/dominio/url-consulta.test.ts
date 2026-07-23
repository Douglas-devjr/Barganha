import { describe, expect, it } from 'vitest';

import { urlConsultaSegura } from './url-consulta';

const QR_RJ =
  'consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode?p=33260612345678000199650010000000011000000016|2|1';

describe('urlConsultaSegura (C2.6)', () => {
  it('promove a consulta http do QR para https', () => {
    // O portal do RJ fechou a porta 80: em http o WebView nem chega a falar
    // HTTP, morre em ERR_CONNECTION_REFUSED.
    expect(urlConsultaSegura(`http://${QR_RJ}`)).toBe(`https://${QR_RJ}`);
  });

  it('preserva a query string intacta (chave de acesso e separadores `|`)', () => {
    const url = urlConsultaSegura(`http://${QR_RJ}`);
    expect(url.endsWith('?p=33260612345678000199650010000000011000000016|2|1')).toBe(true);
  });

  it('deixa uma URL já em https inalterada', () => {
    expect(urlConsultaSegura(`https://${QR_RJ}`)).toBe(`https://${QR_RJ}`);
  });

  it('não mexe num payload que não seja http (QR de outro formato)', () => {
    expect(urlConsultaSegura('33260612345678000199650010000000011000000016')).toBe(
      '33260612345678000199650010000000011000000016',
    );
  });

  it('só troca o ESQUEMA, não ocorrências de "http://" no meio da URL', () => {
    const comRedirect = 'http://portal.exemplo/r?destino=http://outro.exemplo';
    expect(urlConsultaSegura(comRedirect)).toBe(
      'https://portal.exemplo/r?destino=http://outro.exemplo',
    );
  });
});
