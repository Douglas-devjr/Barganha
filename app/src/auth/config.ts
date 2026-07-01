/**
 * C4.3.1 — Configuração do Supabase Auth no app. Mesma ordem de prioridade do
 * resto da config (api/config.ts): env `EXPO_PUBLIC_*` (embutida no build) →
 * `extra` do app.json. A ANON KEY é pública por design — o acesso é protegido
 * por RLS no banco (ver migração de auth); a SERVICE ROLE só existe no backend.
 */

import Constants from 'expo-constants';

interface SupabaseExtra {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export interface ConfigSupabase {
  url: string;
  anonKey: string;
}

export function obterConfigSupabase(): ConfigSupabase {
  const extra = (Constants.expoConfig?.extra ?? {}) as SupabaseExtra;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? '';

  if (!url || !anonKey) {
    throw new Error(
      'Supabase não configurado: defina EXPO_PUBLIC_SUPABASE_URL e ' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY (ver app/.env.example).',
    );
  }
  return { url, anonKey };
}
