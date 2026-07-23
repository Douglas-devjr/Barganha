import { describe, expect, it } from 'vitest';

import { VerificadorTokenCache, type VerificadorToken } from './verificador-token';

/** Verificador que conta quantas vezes foi de fato consultado. */
class VerificadorEspiao implements VerificadorToken {
  chamadas = 0;
  constructor(private readonly mapa: Record<string, string | undefined>) {}
  verificar(token: string): Promise<string | undefined> {
    this.chamadas++;
    return Promise.resolve(this.mapa[token]);
  }
}

/** Monta um JWT de mentira só com o `exp` — a assinatura não é lida. */
function jwtCom(expSegundos: number): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ exp: expSegundos })}.assinatura-falsa`;
}

describe('VerificadorTokenCache', () => {
  it('consulta o GoTrue UMA vez e serve as repetições do cache', async () => {
    const espiao = new VerificadorEspiao({ 'tok-a': 'user-a' });
    const cache = new VerificadorTokenCache(espiao);

    expect(await cache.verificar('tok-a')).toBe('user-a');
    expect(await cache.verificar('tok-a')).toBe('user-a');
    expect(await cache.verificar('tok-a')).toBe('user-a');
    expect(espiao.chamadas).toBe(1);
  });

  it('revalida quando a janela do cache vence', async () => {
    let agora = 1_000_000;
    const espiao = new VerificadorEspiao({ 'tok-a': 'user-a' });
    const cache = new VerificadorTokenCache(espiao, 60_000, () => agora);

    await cache.verificar('tok-a');
    agora += 59_000;
    await cache.verificar('tok-a');
    expect(espiao.chamadas).toBe(1);

    agora += 2_000; // passou dos 60s
    await cache.verificar('tok-a');
    expect(espiao.chamadas).toBe(2);
  });

  it('NÃO memoriza negativa — token inválido volta a ser verificado', async () => {
    // Cachear falha transformaria uma indisponibilidade momentânea da Auth API
    // num 401 grudado para um usuário legítimo.
    const espiao = new VerificadorEspiao({});
    const cache = new VerificadorTokenCache(espiao);

    expect(await cache.verificar('tok-ruim')).toBeUndefined();
    expect(await cache.verificar('tok-ruim')).toBeUndefined();
    expect(espiao.chamadas).toBe(2);
  });

  it('nunca sobrevive ao `exp` do próprio token', async () => {
    // Um JWT que expira em 5s não pode ficar valendo 60s por estar em cache.
    let agora = 1_000_000;
    const token = jwtCom(Math.floor(agora / 1000) + 5);
    const espiao = new VerificadorEspiao({ [token]: 'user-a' });
    const cache = new VerificadorTokenCache(espiao, 60_000, () => agora);

    await cache.verificar(token);
    agora += 6_000; // token já expirou, embora a janela de 60s não
    await cache.verificar(token);
    expect(espiao.chamadas).toBe(2);
  });

  it('separa os usuários por token', async () => {
    const espiao = new VerificadorEspiao({ 'tok-a': 'user-a', 'tok-b': 'user-b' });
    const cache = new VerificadorTokenCache(espiao);

    expect(await cache.verificar('tok-a')).toBe('user-a');
    expect(await cache.verificar('tok-b')).toBe('user-b');
    expect(await cache.verificar('tok-a')).toBe('user-a');
    expect(espiao.chamadas).toBe(2);
  });
});
