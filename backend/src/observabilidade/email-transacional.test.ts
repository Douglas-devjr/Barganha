import { describe, expect, it, vi } from 'vitest';

import { enviarEmail } from './email-transacional';

const PARAMS = {
  destinatario: 'pessoa@example.com',
  assunto: 'Assunto de teste',
  corpoTexto: 'Corpo de teste',
  referencia: 'conta-123',
};

describe('enviarEmail (Resend, C9.2)', () => {
  it('sem apiKey: devolve false sem chamar fetch', async () => {
    const fetchFn = vi.fn();

    const r = await enviarEmail(PARAMS, { remetente: 'contato@barganha.app', fetchFn });

    expect(r).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sem remetente: devolve false sem chamar fetch', async () => {
    const fetchFn = vi.fn();

    const r = await enviarEmail(PARAMS, { apiKey: 'chave-secreta', fetchFn });

    expect(r).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('configurado: faz POST correto para a API da Resend', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);

    const r = await enviarEmail(PARAMS, {
      apiKey: 'chave-secreta',
      remetente: 'contato@barganha.app',
      fetchFn,
    });

    expect(r).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer chave-secreta');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'contato@barganha.app',
      to: [PARAMS.destinatario],
      subject: PARAMS.assunto,
      text: PARAMS.corpoTexto,
    });
  });

  it('resposta não-ok da API: devolve false', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 422 } as Response);

    const r = await enviarEmail(PARAMS, {
      apiKey: 'chave-secreta',
      remetente: 'contato@barganha.app',
      fetchFn,
    });

    expect(r).toBe(false);
  });

  it('fetch lançando erro (rede fora): devolve false sem propagar', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('rede fora'));

    const r = await enviarEmail(PARAMS, {
      apiKey: 'chave-secreta',
      remetente: 'contato@barganha.app',
      fetchFn,
    });

    expect(r).toBe(false);
  });
});
