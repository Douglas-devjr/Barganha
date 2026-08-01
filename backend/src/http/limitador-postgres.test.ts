/**
 * Testes do limitador Postgres (C9.3.2).
 *
 * Compartilha o mesmo contrato que `LimitadorJanelaFixa`, então roda os
 * mesmos testes com adaptador diferente (banco em vez de memória).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import { LimitadorJanelaFixaPostgres } from './limitador-postgres';

describe('LimitadorJanelaFixaPostgres', () => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Limpa a tabela de rate-limit antes de cada teste.
  beforeEach(async () => {
    await supabase.from('rate_limit_janela').delete().neq('chave', '');
  });

  it('permite requisições dentro do limite', async () => {
    const agora = Date.now();
    const limitador = new LimitadorJanelaFixaPostgres(supabase, {
      janelaMs: 1000,
      maximo: 2,
      agora: () => agora,
    });

    expect(await limitador.permitir('ip:127.0.0.1')).toBe(true);
    expect(await limitador.permitir('ip:127.0.0.1')).toBe(true);
  });

  it('rejeita requisições acima do limite', async () => {
    const agora = Date.now();
    const limitador = new LimitadorJanelaFixaPostgres(supabase, {
      janelaMs: 1000,
      maximo: 2,
      agora: () => agora,
    });

    await limitador.permitir('ip:127.0.0.1');
    await limitador.permitir('ip:127.0.0.1');
    expect(await limitador.permitir('ip:127.0.0.1')).toBe(false);
  });

  it('reseta a janela quando ela expira', async () => {
    let agora = Date.now();
    const limitador = new LimitadorJanelaFixaPostgres(supabase, {
      janelaMs: 1000,
      maximo: 1,
      agora: () => agora,
    });

    expect(await limitador.permitir('ip:127.0.0.1')).toBe(true);
    expect(await limitador.permitir('ip:127.0.0.1')).toBe(false);

    // Avança 1.1s (além da janela).
    agora += 1100;

    // Janela resetou, permite de novo.
    expect(await limitador.permitir('ip:127.0.0.1')).toBe(true);
  });

  it('isola chaves diferentes', async () => {
    const agora = Date.now();
    const limitador = new LimitadorJanelaFixaPostgres(supabase, {
      janelaMs: 1000,
      maximo: 1,
      agora: () => agora,
    });

    expect(await limitador.permitir('ip:127.0.0.1')).toBe(true);
    expect(await limitador.permitir('ip:127.0.0.1')).toBe(false);

    // IP diferente tem sua própria janela.
    expect(await limitador.permitir('ip:127.0.0.2')).toBe(true);
  });
});
