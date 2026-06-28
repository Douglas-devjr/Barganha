/**
 * C5 — Componente raiz do app. Orquestra o boot:
 *   1. carrega a fonte Plus Jakarta Sans (C5.2),
 *   2. inicializa o SQLite local (C5.3),
 *   3. garante a conta anônima em background (C4.3, não bloqueia a UI),
 *   4. monta a navegação (C5.1).
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
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Texto } from '@/componentes';
import { inicializarBd } from '@/dados';
import { RaizNavegador } from '@/navegacao';
import { garantirContaAnonima } from '@/nucleo/bootstrap';
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

  useEffect(() => {
    let ativo = true;
    (async () => {
      await inicializarBd();
      if (!ativo) return;
      setBdPronto(true);
      // Conta anônima em background — não bloqueia a navegação.
      void garantirContaAnonima();
    })();
    return () => {
      ativo = false;
    };
  }, []);

  const pronto = fontesProntas && bdPronto;

  if (!pronto) {
    return <Splash />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer>
        <RaizNavegador />
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
