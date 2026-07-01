import { describe, expect, it } from 'vitest';

import { AutenticadorSupabase } from './autenticador-supabase';
import type { VerificadorToken } from './verificador-token';

/** Verificador falso: mapeia tokens conhecidos → usuarioId (sem rede). */
class VerificadorFake implements VerificadorToken {
  constructor(private readonly validos: Record<string, string>) {}
  verificar(token: string): Promise<string | undefined> {
    return Promise.resolve(this.validos[token]);
  }
}

describe('AutenticadorSupabase (C4.3.1)', () => {
  const auth = new AutenticadorSupabase(new VerificadorFake({ 'jwt-bom': 'user-42' }));

  it('resolve o usuário a partir de um JWT válido no Bearer', async () => {
    expect(await auth.resolver({ authorization: 'Bearer jwt-bom' })).toBe('user-42');
  });

  it('rejeita token inválido/expirado (→ undefined → 401 na camada HTTP)', async () => {
    expect(await auth.resolver({ authorization: 'Bearer jwt-ruim' })).toBeUndefined();
  });

  it('rejeita request sem credencial', async () => {
    expect(await auth.resolver({})).toBeUndefined();
    expect(await auth.resolver({ authorization: 'Basic zzz' })).toBeUndefined();
  });

  it('não confia em UUID cru no header legado (precisa ser JWT válido)', async () => {
    // Sob login obrigatório, um id solto no header legado não autentica:
    // o verificador (JWT) não o reconhece.
    expect(await auth.resolver({ 'x-usuario-id': 'user-42' })).toBeUndefined();
  });
});
