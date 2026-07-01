/**
 * C4.3.1 — Estado de autenticação do app (login obrigatório, Supabase Auth).
 *
 * Expõe a sessão atual e as ações de auth (email/senha, Google, reset, sair). É
 * a fonte da verdade que o gate de navegação usa para decidir entre as telas de
 * login e o app (ver App.tsx).
 *
 * Pegada nativa mínima: email/senha usa só JS (supabase-js) + o SQLite que já é
 * nativo. O Google precisa do `expo-web-browser` (nativo), então ele é importado
 * SOB DEMANDA (no clique) — assim o app sobe e o login por senha funciona mesmo
 * num dev build que ainda não tem esse módulo; o Google pede um build novo.
 *
 * LGPD (docs/04): o dado de login (email, identidade Google) é o MÍNIMO para
 * autenticar e mora no Supabase Auth — nunca cruza para o pool compartilhado. Ao
 * sair, limpamos também o lado PRIVADO local deste aparelho (`redefinirAppLocal`).
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Session, User } from '@supabase/supabase-js';

import { redefinirAppLocal } from '@/nucleo/conta';

import { supabase } from './supabase';

// Deep link de retorno do app (esquema `barganha`, app.json). Vale para o dev
// build e o standalone; cadastre-o em Supabase → Auth → URL Configuration.
const REDIRECT = 'barganha://auth-callback';

export interface ResultadoAuth {
  /** Mensagem de erro pronta para a UI; ausente em sucesso. */
  erro?: string;
  /** Cadastro que exige confirmar o email antes de logar. */
  precisaConfirmarEmail?: boolean;
}

interface ValorAuth {
  sessao: Session | null;
  usuario: User | null;
  /** `true` enquanto a sessão persistida ainda não foi carregada no boot. */
  carregando: boolean;
  entrarComSenha(email: string, senha: string): Promise<ResultadoAuth>;
  cadastrar(email: string, senha: string): Promise<ResultadoAuth>;
  entrarComGoogle(): Promise<ResultadoAuth>;
  enviarResetSenha(email: string): Promise<ResultadoAuth>;
  sair(): Promise<void>;
}

const ContextoAuth = createContext<ValorAuth | null>(null);

/** Traduz os erros do Supabase Auth para mensagens em PT-BR amigáveis. */
function traduzErro(mensagem: string): string {
  const m = mensagem.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu email antes de entrar.';
  if (m.includes('user already registered')) return 'Este email já tem conta. Tente entrar.';
  if (m.includes('password should be at least'))
    return 'A senha precisa ter pelo menos 6 caracteres.';
  if (m.includes('unable to validate email') || m.includes('invalid email'))
    return 'Email inválido.';
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Muitas tentativas. Tente de novo em instantes.';
  // Módulo nativo do navegador ausente (dev build sem expo-web-browser).
  if (m.includes('native module') || m.includes('expowebbrowser') || m.includes('cannot find native'))
    return 'Login com Google requer um novo build do app. Use email e senha por enquanto.';
  if (m.includes('network')) return 'Sem conexão. Verifique a internet e tente de novo.';
  return mensagem;
}

/** Resolve a sessão a partir da URL de retorno do OAuth (PKCE → código). */
async function trocarCodigoDaUrl(url: string): Promise<void> {
  const u = new URL(url);
  const erro = u.searchParams.get('error_description') ?? u.searchParams.get('error');
  if (erro) throw new Error(erro);
  const code = u.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      setSessao(data.session);
      setCarregando(false);
    });

    // Mantém o estado em sincronia com login/logout/refresh do token.
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, novaSessao) => {
      setSessao(novaSessao);
      setCarregando(false);
    });
    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const valor = useMemo<ValorAuth>(
    () => ({
      sessao,
      usuario: sessao?.user ?? null,
      carregando,

      async entrarComSenha(email, senha) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: senha,
        });
        return error ? { erro: traduzErro(error.message) } : {};
      },

      async cadastrar(email, senha) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: senha,
          options: { emailRedirectTo: REDIRECT },
        });
        if (error) return { erro: traduzErro(error.message) };
        // Sem sessão de imediato → projeto exige confirmação de email.
        return { precisaConfirmarEmail: data.session == null };
      },

      async entrarComGoogle() {
        try {
          // Importado sob demanda: módulo nativo só exigido aqui (ver topo).
          const WebBrowser = await import('expo-web-browser');
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: REDIRECT, skipBrowserRedirect: true },
          });
          if (error || !data.url) {
            return { erro: error ? traduzErro(error.message) : 'Falha ao iniciar o login.' };
          }
          const res = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT);
          if (res.type === 'success') {
            await trocarCodigoDaUrl(res.url);
            return {};
          }
          if (res.type === 'cancel' || res.type === 'dismiss') {
            return { erro: 'Login com Google cancelado.' };
          }
          return { erro: 'Não foi possível entrar com o Google.' };
        } catch (e) {
          return { erro: traduzErro(e instanceof Error ? e.message : String(e)) };
        }
      },

      async enviarResetSenha(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: REDIRECT,
        });
        return error ? { erro: traduzErro(error.message) } : {};
      },

      async sair() {
        await supabase.auth.signOut();
        // LGPD (docs/04): apaga o lado PRIVADO local deste aparelho. O pool
        // anônimo já enviado não é "seu" e permanece (sem vínculo com você).
        await redefinirAppLocal();
      },
    }),
    [sessao, carregando],
  );

  return <ContextoAuth.Provider value={valor}>{children}</ContextoAuth.Provider>;
}

export function useAuth(): ValorAuth {
  const ctx = useContext(ContextoAuth);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}
