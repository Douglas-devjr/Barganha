/**
 * C5.1 — Stack raiz: as abas + as telas de fluxo (scan, nota fiscal, detalhe do
 * produto). O `Scanner` abre como modal (vindo do FAB). A rota inicial é o
 * Onboarding (C6.4) enquanto não houver consentimento; depois, as abas.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { NotaFiscalTela } from '@/telas/NotaFiscalTela';
import { OnboardingTela } from '@/telas/OnboardingTela';
import { ProdutoDetalheTela } from '@/telas/ProdutoDetalheTela';
import { ScannerTela } from '@/telas/ScannerTela';

import { AbasNavegador } from './AbasNavegador';
import type { RootStackParamList } from './tipos';

const Stack = createNativeStackNavigator<RootStackParamList>();

export interface RaizNavegadorProps {
  /** Pula o onboarding quando o consentimento já foi dado (C6.4). */
  consentido: boolean;
}

export function RaizNavegador({ consentido }: RaizNavegadorProps) {
  return (
    <Stack.Navigator
      initialRouteName={consentido ? 'Abas' : 'Onboarding'}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen
        name="Onboarding"
        component={OnboardingTela}
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen name="Abas" component={AbasNavegador} />
      <Stack.Screen name="Scanner" component={ScannerTela} options={{ presentation: 'modal' }} />
      <Stack.Screen name="NotaFiscal" component={NotaFiscalTela} />
      <Stack.Screen name="ProdutoDetalhe" component={ProdutoDetalheTela} />
    </Stack.Navigator>
  );
}
