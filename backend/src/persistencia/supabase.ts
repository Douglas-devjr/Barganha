/**
 * Fábrica do cliente Supabase do backend. Usa a SERVICE ROLE KEY — só no
 * servidor, nunca no app (docs/.env.example). Sem sessão persistida: é um
 * processo de servidor, não um navegador.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function criarClienteSupabase(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
