/**
 * C4.3.1 — Cliente Supabase do APP (login real). Usa a ANON KEY (pública) e
 * persiste a sessão no SQLite local (`armazenamentoSessao`, sobre `expo-sqlite`,
 * que já é nativo no app — nenhum módulo nativo novo só para isso). O access
 * token (JWT) desta sessão é o Bearer dos endpoints PRIVADOS do backend.
 *
 * `flowType: 'pkce'` habilita o OAuth nativo (Google) com troca segura de código.
 * `react-native-url-polyfill` é JS puro e dá um `URL` completo (usado pelo
 * supabase-js e por nós ao ler o código do retorno do OAuth).
 */

import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { armazenamentoSessao } from './armazenamento';
import { obterConfigSupabase } from './config';

const { url, anonKey } = obterConfigSupabase();

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: armazenamentoSessao,
    autoRefreshToken: true,
    persistSession: true,
    // Não há URL de navegador no RN — a sessão do OAuth é resolvida à mão
    // (expo-web-browser + exchangeCodeForSession), não pela detecção automática.
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// Recomendação oficial (Supabase RN): só renova o token enquanto o app está
// em foco — economiza bateria/rede e evita refresh em background.
AppState.addEventListener('change', (estado) => {
  if (estado === 'active') void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});
