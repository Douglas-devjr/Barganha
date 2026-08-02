/**
 * C4.3.1 — Estado de autenticação do app (login obrigatório, Supabase Auth).
 *
 * Expõe a sessão atual e as ações de auth (email/senha, Google, reset e troca
 * de senha, sair). É a fonte da verdade que o gate de navegação usa para
 * decidir entre as telas de login, a troca de senha pós-link e o app (App.tsx).
 * Também escuta o deep link `barganha://auth-callback` dos links de email.
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
import { Alert, Linking } from 'react-native';

import type { Session, User } from '@supabase/supabase-js';

import { encerrarAlertasNoServidor } from '@/nucleo/alertas';
import { enviarPendentesAntesDeSair, redefinirAppLocal } from '@/nucleo/conta';
import { removerTokenPushAtual } from '@/nucleo/notificacoes-push';

import { obterUrlCallbackEmail } from './config';
import { supabase } from './supabase';

// Deep link de retorno do app (esquema `barganha`, app.json). É o alvo FINAL do
// retorno: o OAuth (Google) volta direto aqui via `openAuthSessionAsync`, e a
// página-ponte dos e-mails salta para cá. Cadastre-o em Supabase → Auth → URL
// Configuration.
const REDIRECT = 'barganha://auth-callback';

// Para onde os LINKS DE E-MAIL (confirmação de cadastro, reset de senha) apontam.
// Precisa ser HTTPS: o navegador do celular recusa abrir o esquema custom vindo
// do redirect automático do Supabase, então passamos por uma página-ponte que
// repassa o `?code=` para `REDIRECT` com um toque (docs/19 §5). Cadastre esta URL
// também nas Redirect URLs do Supabase.
const REDIRECT_EMAIL = obterUrlCallbackEmail();

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
  /** `true` após abrir o link de "esqueci a senha" — o gate força a tela de nova senha. */
  recuperandoSenha: boolean;
  entrarComSenha(email: string, senha: string): Promise<ResultadoAuth>;
  /**
   * `nomeExibicao` é OPCIONAL e serve só para o app chamar a pessoa pelo nome.
   * Sem ele, a saudação é neutra — nunca o pedaço do email, que produz
   * "Olá, knowenter" e soa como sistema, não como produto.
   */
  cadastrar(email: string, senha: string, nomeExibicao?: string): Promise<ResultadoAuth>;
  /** Grava/limpa o nome de exibição em `user_metadata` (editável no Perfil). */
  definirNomeExibicao(nome: string): Promise<ResultadoAuth>;
  entrarComGoogle(): Promise<ResultadoAuth>;
  enviarResetSenha(email: string): Promise<ResultadoAuth>;
  atualizarSenha(novaSenha: string): Promise<ResultadoAuth>;
  /** Sai da tela de nova senha sem trocar (a sessão do link continua válida). */
  cancelarRecuperacao(): void;
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
  if (m.includes('different from the old')) return 'A nova senha precisa ser diferente da atual.';
  if (m.includes('session missing') || m.includes('session_not_found'))
    return 'Sessão expirada. Peça um novo link de recuperação.';
  // Módulo nativo do navegador ausente (dev build sem expo-web-browser).
  if (
    m.includes('native module') ||
    m.includes('expowebbrowser') ||
    m.includes('cannot find native')
  )
    return 'Login com Google requer um novo build do app. Use email e senha por enquanto.';
  if (m.includes('network')) return 'Sem conexão. Verifique a internet e tente de novo.';
  return mensagem;
}

// URLs de retorno já processadas. No Android o mesmo retorno pode chegar duas
// vezes (resultado do navegador do Google E o listener de deep link); trocar o
// mesmo código duas vezes falharia na segunda.
const urlsProcessadas = new Set<string>();

/** Resolve a sessão a partir da URL de retorno (OAuth ou link de email; PKCE → código). */
async function trocarCodigoDaUrl(url: string): Promise<void> {
  if (urlsProcessadas.has(url)) return;
  urlsProcessadas.add(url);
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
  const [recuperandoSenha, setRecuperandoSenha] = useState(false);

  useEffect(() => {
    let ativo = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      setSessao(data.session);
      setCarregando(false);
    });

    // Mantém o estado em sincronia com login/logout/refresh do token. O evento
    // PASSWORD_RECOVERY vem da troca de código iniciada por resetPasswordForEmail.
    const { data: sub } = supabase.auth.onAuthStateChange((evento, novaSessao) => {
      if (evento === 'PASSWORD_RECOVERY') setRecuperandoSenha(true);
      setSessao(novaSessao);
      setCarregando(false);
    });
    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Links de email (reset de senha, confirmação de cadastro) voltam para o app
  // pelo deep link `barganha://auth-callback?code=...` — tanto com o app aberto
  // (evento `url`) quanto no boot a partir do link (getInitialURL). A troca do
  // código cria a sessão; no reset ela também dispara PASSWORD_RECOVERY (acima).
  useEffect(() => {
    function tratar(url: string | null) {
      if (!url?.startsWith(REDIRECT)) return;
      void trocarCodigoDaUrl(url).catch(() => {
        Alert.alert('Link inválido ou expirado', 'Peça um novo link e tente de novo.');
      });
    }
    void Linking.getInitialURL().then(tratar);
    const sub = Linking.addEventListener('url', (e) => tratar(e.url));
    return () => sub.remove();
  }, []);

  const valor = useMemo<ValorAuth>(
    () => ({
      sessao,
      usuario: sessao?.user ?? null,
      carregando,
      recuperandoSenha,

      async entrarComSenha(email, senha) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: senha,
        });
        return error ? { erro: traduzErro(error.message) } : {};
      },

      async cadastrar(email, senha, nomeExibicao) {
        const nome = nomeExibicao?.trim();
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: senha,
          options: {
            emailRedirectTo: REDIRECT_EMAIL,
            // Vai para `user_metadata` em `auth.users` — o mesmo lugar onde o
            // Google já entrega o `full_name`. NÃO desce para `public.usuario` e
            // jamais cruza para o pool: o mundo compartilhado continua sem
            // qualquer campo de pessoa (decisão travada nº3, docs/04).
            ...(nome ? { data: { nome } } : {}),
          },
        });
        if (error) return { erro: traduzErro(error.message) };
        // Sem sessão de imediato → projeto exige confirmação de email.
        return { precisaConfirmarEmail: data.session == null };
      },

      async definirNomeExibicao(nome) {
        const limpo = nome.trim();
        const { error } = await supabase.auth.updateUser({
          // String vazia (o usuário limpou o campo) grava `null`, e a UI volta a
          // saudar sem nome — em vez de recair no pedaço do email.
          data: { nome: limpo.length > 0 ? limpo : null },
        });
        return error ? { erro: traduzErro(error.message) } : {};
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
          redirectTo: REDIRECT_EMAIL,
        });
        return error ? { erro: traduzErro(error.message) } : {};
      },

      async atualizarSenha(novaSenha) {
        const { error } = await supabase.auth.updateUser({ password: novaSenha });
        if (error) return { erro: traduzErro(error.message) };
        setRecuperandoSenha(false);
        return {};
      },

      cancelarRecuperacao() {
        setRecuperandoSenha(false);
      },

      async sair() {
        // ANTES de limpar: tenta subir o que ainda está na fila de upload. A
        // limpeza apaga `fila_upload`, então sem esta tentativa uma compra
        // registrada offline sumia sem aviso ao sair (a tela avisa quando
        // sobra algo — ver PerfilTela).
        await enviarPendentesAntesDeSair();
        // Também ANTES de sair: revoga o espelho de alertas + o token de push
        // no servidor, ainda com a sessão válida (as rotas exigem Bearer). Sem
        // isto, um aparelho compartilhado continuaria recebendo "Preço baixou"
        // depois que a pessoa saiu — furando a mesma higiene que
        // `redefinirAppLocal` já faz do lado do SQLite. Best-effort: nenhuma
        // das duas pode impedir o logout (offline, backend fora).
        await Promise.all([encerrarAlertasNoServidor(), removerTokenPushAtual()]);
        await supabase.auth.signOut();
        // LGPD (docs/04): apaga o lado PRIVADO local deste aparelho. O pool
        // anônimo já enviado não é "seu" e permanece (sem vínculo com você).
        await redefinirAppLocal();
      },
    }),
    [sessao, carregando, recuperandoSenha],
  );

  return <ContextoAuth.Provider value={valor}>{children}</ContextoAuth.Provider>;
}

export function useAuth(): ValorAuth {
  const ctx = useContext(ContextoAuth);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}
