/**
 * C5 — Componente raiz do app. Orquestra o boot:
 *   1. carrega a fonte Plus Jakarta Sans (C5.2),
 *   2. inicializa o SQLite local (C5.3),
 *   3. lê o consentimento p/ decidir a rota inicial (onboarding vs. abas, C6.4),
 *   4. garante a conta anônima + drena a fila de upload em background (C4.3/C6.2),
 *   5. monta a navegação (C5.1).
 *
 * Enquanto fonte/banco não estão prontos, exibe uma splash simples com a marca.
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

import { Texto } from '@/componentes';
import { inicializarBd, meta } from '@/dados';
import { RaizNavegador } from '@/navegacao';
import { garantirContaAnonima } from '@/nucleo/bootstrap';
import { sincronizar } from '@/nucleo/sincronizador';
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
  const [consentido, setConsentido] = useState<boolean | null>(null);

  useEffect(() => {
    let ativo = true;
    (async () => {
      await inicializarBd();
      const consent = await meta.obterConsentimentoEm();
      if (!ativo) return;
      setConsentido(consent != null);
      setBdPronto(true);
      // Conta anônima + sincronização em background — não bloqueiam a navegação.
      void garantirContaAnonima().then(() => sincronizar());
    })();
    return () => {
      ativo = false;
    };
  }, []);

  // Ao voltar para o app, tenta drenar a fila de upload e concluir parsings (C6.2).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void sincronizar();
    });
    return () => sub.remove();
  }, []);

  const pronto = fontesProntas && bdPronto && consentido !== null;

  if (!pronto) {
    return <Splash />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer>
        <RaizNavegador consentido={consentido === true} />
      </NavigationContainer>
    </SafeAreaProvider>
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
