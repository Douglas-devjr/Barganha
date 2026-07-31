/**
 * C5 — Componente raiz do app. Orquestra o boot e os três gates de acesso:
 *   1. carrega a fonte Instrument Sans (C5.2) + inicializa o SQLite (C5.3);
 *   2. CONSENTIMENTO (C6.4) — onboarding LGPD; sem ele, nada mais aparece;
 *   3. LOGIN (C4.3.1) — sessão do Supabase Auth; obrigatório para usar o app;
 *   4. APP — abas + fluxos; drena a fila de upload e sincroniza em background.
 *
 * Enquanto fonte/banco não estão prontos (ou a sessão é carregada), exibe a
 * ABERTURA (`SplashTela`) — a marca se construindo, por no mínimo 1,9 s. As
 * esperas curtas de dentro do gate repetem a mesma tela já pronta
 * (`animar={false}`), para não reiniciar a construção no meio do caminho.
 */

import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
  useFonts,
} from '@expo-google-fonts/instrument-sans';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/auth';
import { ProvedorToast } from '@/componentes';
import { cupons, inicializarBd, meta } from '@/dados';
import { AuthNavegador, RaizNavegador } from '@/navegacao';
import { sincronizar } from '@/nucleo/sincronizador';
import { ProvedorPlano } from '@/plano';
import { AberturaFluxo } from '@/telas/abertura/AberturaFluxo';
import { OnboardingTela } from '@/telas/OnboardingTela';
import { SplashTela } from '@/telas/SplashTela';
import { RedefinirSenhaTela } from '@/telas/auth/RedefinirSenhaTela';
import { ProvedorTema, useTema } from '@/tema';

export default function App() {
  const [fontesProntas] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });
  const [bdPronto, setBdPronto] = useState(false);
  const [consentidoInicial, setConsentidoInicial] = useState<boolean | null>(null);
  /** A abertura cumpriu os 1,9 s do handoff (ou o usuário tocou para pular). */
  const [aberturaVista, setAberturaVista] = useState(false);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      await inicializarBd();
      const consent = await meta.obterConsentimentoEm();
      if (!ativo) return;
      setConsentidoInicial(consent != null);
      setBdPronto(true);
      // Limpeza retroativa do CPF nos QRs espelhados (docs/04). Best-effort e
      // DEPOIS de liberar a tela: é higiene de dado antigo, não pode segurar o
      // boot nem derrubar o app se falhar.
      void cupons.sanearQrsProcessados().catch(() => {});
    })();
    return () => {
      ativo = false;
    };
  }, []);

  const pronto = fontesProntas && bdPronto && consentidoInicial !== null;

  return (
    <ProvedorTema>
      <AuthProvider>
        <SafeAreaProvider>
          {/* O toast fica acima de tudo: é global e aparece sobre a tab bar. */}
          <ProvedorToast>
            <BarraStatus />
            {/* A abertura sai quando o boot terminou E ela já foi vista por
                inteiro — o que vier primeiro espera pelo outro. Fica no mesmo
                slot para não remontar (remontar reiniciaria a construção). */}
            {pronto && aberturaVista ? (
              // O plano lê o SQLite, então só entra depois do boot do banco.
              <ProvedorPlano>
                <Conteudo consentidoInicial={consentidoInicial!} />
              </ProvedorPlano>
            ) : (
              <SplashTela aoConcluir={() => setAberturaVista(true)} />
            )}
          </ProvedorToast>
        </SafeAreaProvider>
      </AuthProvider>
    </ProvedorTema>
  );
}

/** Barra de status que acompanha o tema (texto claro no escuro, escuro no claro). */
function BarraStatus() {
  const { escuro } = useTema();
  return <StatusBar style={escuro ? 'light' : 'dark'} />;
}

/**
 * Gate de navegação: consentimento → login → ABERTURA → app. Consome a sessão
 * de auth.
 *
 * A ABERTURA (boas-vindas + permissão de câmera + região) roda uma vez por
 * APARELHO, entre o login e as abas. Fica no gate, e não como rota do stack,
 * porque tem ordem e não pode ser desempilhada para dentro do app.
 */
function Conteudo({ consentidoInicial }: { consentidoInicial: boolean }) {
  const { sessao, carregando, recuperandoSenha } = useAuth();
  const [consentido, setConsentido] = useState(consentidoInicial);
  /** `null` = ainda lendo; `true`/`false` = abertura já concluída neste aparelho. */
  const [aberturaFeita, setAberturaFeita] = useState<boolean | null>(null);

  // Sincroniza (upload da fila + delta) quando há sessão e ao voltar ao app.
  useEffect(() => {
    if (sessao) void sincronizar();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active' && sessao) void sincronizar();
    });
    return () => sub.remove();
  }, [sessao]);

  // O estado da abertura é relido a cada nova sessão (contas diferentes no mesmo
  // aparelho não repetem o fluxo — a flag é do aparelho, não da conta).
  useEffect(() => {
    if (!sessao) {
      setAberturaFeita(null);
      return;
    }
    let vivo = true;
    void meta.obterAberturaEm().then((em) => {
      if (vivo) setAberturaFeita(em != null);
    });
    return () => {
      vivo = false;
    };
  }, [sessao]);

  if (!consentido) {
    return <OnboardingTela aoConcordar={() => setConsentido(true)} />;
  }
  if (carregando) {
    return <SplashTela animar={false} />;
  }
  // Chegou pelo link de "esqueci a senha": troca a senha antes de liberar o app.
  if (recuperandoSenha) {
    return <RedefinirSenhaTela />;
  }

  if (!sessao) {
    return (
      <NavigationContainer>
        <AuthNavegador />
      </NavigationContainer>
    );
  }

  // Há sessão: espera saber o estado da abertura antes de decidir (evita piscar
  // as abas por um frame antes de mandar para a abertura).
  if (aberturaFeita === null) {
    return <SplashTela animar={false} />;
  }
  if (!aberturaFeita) {
    return <AberturaFluxo aoConcluir={() => setAberturaFeita(true)} />;
  }

  return (
    <NavigationContainer>
      <RaizNavegador />
    </NavigationContainer>
  );
}
