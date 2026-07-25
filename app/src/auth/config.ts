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
  authEmailRedirect?: string;
}

export interface ConfigSupabase {
  url: string;
  anonKey: string;
}

/**
 * Página-ponte HTTPS para onde os LINKS DE E-MAIL de auth (confirmar cadastro,
 * recuperar senha) redirecionam. Ela repassa o `?code=` para o esquema do app
 * (`barganha://auth-callback`). Necessária porque o navegador do celular recusa
 * abrir um esquema custom vindo do redirect automático do Supabase (docs/19 §5).
 *
 * NÃO é usada pelo OAuth (Google), que retorna direto no esquema custom via
 * `openAuthSessionAsync`. Default: o GitHub Pages atual (ver site/README.md);
 * sobrescreva por env quando houver domínio próprio/App Links.
 */
export function obterUrlCallbackEmail(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as SupabaseExtra;
  return (
    process.env.EXPO_PUBLIC_AUTH_EMAIL_REDIRECT ??
    extra.authEmailRedirect ??
    'https://douglas-devjr.github.io/barganha-legal/auth-callback.html'
  );
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
