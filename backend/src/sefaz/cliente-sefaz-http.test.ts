import { describe, expect, it, vi } from 'vitest';

import { FalhaBuscaSefazError, PayloadQrInvalidoError } from '../erros';
import { parseQrNfce } from '../parsers/qr-payload';
import { ClienteSefazHttp } from './cliente-sefaz-http';

const QR = parseQrNfce(
  'https://www.fazenda.rj.gov.br/nfce/qrcode?p=33260612345678000199650010000000011000000016|2|1',
);

function respostaFake(body: string | Uint8Array, init: ResponseInit): typeof fetch {
  return vi.fn().mockResolvedValue(new Response(body, init)) as unknown as typeof fetch;
}

describe('ClienteSefazHttp (C2)', () => {
  it('decodifica latin1 quando o portal declara ISO-8859-1', async () => {
    // "Atlântica" em latin1: â = 0xE2.
    const bytes = new Uint8Array([0x41, 0x74, 0x6c, 0xe2, 0x6e, 0x74, 0x69, 0x63, 0x61]);
    const cliente = new ClienteSefazHttp({
      fetch: respostaFake(bytes, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=ISO-8859-1' },
      }),
    });
    expect(await cliente.buscarConsulta(QR)).toBe('Atlântica');
  });

  it('mapeia status não-OK para erro transitório (retry)', async () => {
    const cliente = new ClienteSefazHttp({ fetch: respostaFake('', { status: 503 }) });
    await expect(cliente.buscarConsulta(QR)).rejects.toThrow(FalhaBuscaSefazError);
  });

  it('mapeia falha de rede para erro transitório (retry)', async () => {
    const fetchFalho = vi
      .fn()
      .mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
    const cliente = new ClienteSefazHttp({ fetch: fetchFalho });
    await expect(cliente.buscarConsulta(QR)).rejects.toThrow(FalhaBuscaSefazError);
  });

  it('trata desafio reCAPTCHA (200) como falha de busca transitória', async () => {
    const gate =
      '<html><body><script>grecaptcha.execute(chave,{action:"x"})</script></body></html>';
    const cliente = new ClienteSefazHttp({ fetch: respostaFake(gate, { status: 200 }) });
    await expect(cliente.buscarConsulta(QR)).rejects.toThrow(FalhaBuscaSefazError);
  });

  it('trata bloqueio por IP (200) como falha de busca transitória', async () => {
    const bloqueio = '<html><body>Verifique seu IP em www.meuip.com.br</body></html>';
    const cliente = new ClienteSefazHttp({ fetch: respostaFake(bloqueio, { status: 200 }) });
    await expect(cliente.buscarConsulta(QR)).rejects.toThrow(FalhaBuscaSefazError);
  });

  it('recusa QR sem URL de consulta', async () => {
    const semUrl = parseQrNfce('33260612345678000199650010000000011000000016');
    const cliente = new ClienteSefazHttp({ fetch: respostaFake('x', { status: 200 }) });
    await expect(cliente.buscarConsulta(semUrl)).rejects.toThrow(PayloadQrInvalidoError);
  });
});
