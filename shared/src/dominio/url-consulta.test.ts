import { describe, expect, it } from 'vitest';

import { urlConsultaConfiavel, urlConsultaSegura } from './url-consulta';

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

describe('urlConsultaConfiavel (C2.6) — porta contra QR malicioso', () => {
  it('aceita os portais dos estados suportados, já promovidos a https', () => {
    // Os quatro hosts que aparecem nas fixtures reais de RJ, MG e SP.
    expect(urlConsultaConfiavel(`http://${QR_RJ}`)).toBe(`https://${QR_RJ}`);
    expect(urlConsultaConfiavel('https://www.fazenda.rj.gov.br/nfce/qrcode?p=x')).not.toBeNull();
    expect(urlConsultaConfiavel('https://nfce.fazenda.mg.gov.br/portalnfce?p=x')).not.toBeNull();
    expect(urlConsultaConfiavel('https://www.nfce.fazenda.sp.gov.br/qrcode?p=x')).not.toBeNull();
  });

  it('preserva os `|` do parâmetro `p` (não passa pelo round-trip do URL)', () => {
    const url = urlConsultaConfiavel(`http://${QR_RJ}`);
    expect(url?.endsWith('?p=33260612345678000199650010000000011000000016|2|1')).toBe(true);
  });

  it('recusa host que não é do governo — o QR de gôndola do atacante', () => {
    expect(urlConsultaConfiavel('https://fazenda-rj.com.br/nfce/qrcode?p=x')).toBeNull();
    expect(urlConsultaConfiavel('https://atacante.example/login?p=x')).toBeNull();
  });

  it('recusa host que só TERMINA parecido com gov.br', () => {
    // `evilgov.br` e `naogov.br` não têm o ponto: são domínios de terceiros.
    expect(urlConsultaConfiavel('https://evilgov.br/x')).toBeNull();
    expect(urlConsultaConfiavel('https://fazenda.rj.gov.br.atacante.com/x')).toBeNull();
  });

  it('recusa credencial embutida que finge o host (o truque do @)', () => {
    // O host REAL aqui é `atacante.com` — quem lê rápido vê "fazenda.rj.gov.br".
    expect(urlConsultaConfiavel('https://consultadfe.fazenda.rj.gov.br@atacante.com/x')).toBeNull();
  });

  it('recusa esquemas que não são https, mesmo com host do governo', () => {
    expect(urlConsultaConfiavel('javascript:alert(1)')).toBeNull();
    expect(urlConsultaConfiavel('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(urlConsultaConfiavel('file:///etc/passwd')).toBeNull();
  });

  it('recusa os alvos de SSRF da rede interna', () => {
    // Com um `?p=` de 44 dígitos o payload passa no parse da chave; o que barra
    // o `fetch` do backend é justamente esta porta.
    const p = '?p=33260612345678000199650010000000011000000016|2|1';
    expect(urlConsultaConfiavel(`http://10.0.0.5/${p}`)).toBeNull();
    expect(urlConsultaConfiavel(`http://127.0.0.1:3000/${p}`)).toBeNull();
    expect(urlConsultaConfiavel(`http://169.254.169.254/latest/meta-data/${p}`)).toBeNull();
    expect(urlConsultaConfiavel(`http://localhost/${p}`)).toBeNull();
  });

  it('devolve null para o QR que traz só a chave (caso normal, não é ataque)', () => {
    expect(urlConsultaConfiavel('33260612345678000199650010000000011000000016')).toBeNull();
  });

  it('trata o FQDN com ponto final como o mesmo host', () => {
    expect(urlConsultaConfiavel('https://nfce.fazenda.mg.gov.br./portalnfce?p=x')).not.toBeNull();
  });
});
