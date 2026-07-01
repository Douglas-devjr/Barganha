/**
 * C5 — Componente raiz do app. Orquestra o boot e os três gates de acesso:
 *   1. carrega a fonte Plus Jakarta Sans (C5.2) + inicializa o SQLite (C5.3);
 *   2. CONSENTIMENTO (C6.4) — onboarding LGPD; sem ele, nada mais aparece;
 *   3. LOGIN (C4.3.1) — sessão do Supabase Auth; obrigatório para usar o app;
 *   4. APP — abas + fluxos; drena a fila de upload e sincroniza em background.
 *
 * Enquanto fonte/banco não estão prontos (ou a sessão é carregada), exibe uma
 * splash simples com a marca.
 */

import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/auth';
import { Texto } from '@/componentes';
import { inicializarBd, meta } from '@/dados';
import { AuthNavegador, RaizNavegador } from '@/navegacao';
import { sincronizar } from '@/nucleo/sincronizador';
import { OnboardingTela } from '@/telas/OnboardingTela';
import { cores } from '@/tema';

export default function App() {
  const [fontesProntas] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const [bdPronto, setBdPronto] = useState(false);
  const [consentidoInicial, setConsentidoInicial] = useState<boolean | null>(null);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      await inicializarBd();
      const consent = await meta.obterConsentimentoEm();
      if (!ativo) return;
      setConsentidoInicial(consent != null);
      setBdPronto(true);
    })();
    return () => {
      ativo = false;
    };
  }, []);

  if (!fontesProntas || !bdPronto || consentidoInicial === null) {
    return <Splash />;
  }

  return (
    <AuthProvider>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Conteudo consentidoInicial={consentidoInicial} />
      </SafeAreaProvider>
    </AuthProvider>
  );
}

/** Gate de navegação: consentimento → login → app. Consome a sessão de auth. */
function Conteudo({ consentidoInicial }: { consentidoInicial: boolean }) {
  const { sessao, carregando } = useAuth();
  const [consentido, setConsentido] = useState(consentidoInicial);

  // Sincroniza (upload da fila + delta) quando há sessão e ao voltar ao app.
  useEffect(() => {
    if (sessao) void sincronizar();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active' && sessao) void sincronizar();
    });
    return () => sub.remove();
  }, [sessao]);

  if (!consentido) {
    return <OnboardingTela aoConcordar={() => setConsentido(true)} />;
  }
  if (carregando) {
    return <Splash />;
  }

  return (
    <NavigationContainer>{sessao ? <RaizNavegador /> : <AuthNavegador />}</NavigationContainer>
  );
}

function Splash() {
  return (
    <View style={estilos.splash}>
      <Texto cor="branco" peso="extrabold" tamanho="display">
        Barganha
      </Texto>
      <ActivityIndicator color={cores.marcaClara} style={{ marginTop: 16 }} />
    </View>
  );
}

const estilos = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: cores.marca },
});
