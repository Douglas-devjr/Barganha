/**
 * C5.1 — Stack raiz: as abas + as telas de fluxo (scan, nota fiscal, detalhe do
 * produto). O `Scanner` abre como modal (vindo do FAB). O onboarding (C6.4) será
 * a rota inicial condicional ao consentimento; por ora as abas abrem direto.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { NotaFiscalTela } from '@/telas/NotaFiscalTela';
import { ProdutoDetalheTela } from '@/telas/ProdutoDetalheTela';
import { ScannerTela } from '@/telas/ScannerTela';

import { AbasNavegador } from './AbasNavegador';
import type { RootStackParamList } from './tipos';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RaizNavegador() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Abas" component={AbasNavegador} />
      <Stack.Screen name="Scanner" component={ScannerTela} options={{ presentation: 'modal' }} />
      <Stack.Screen name="NotaFiscal" component={NotaFiscalTela} />
      <Stack.Screen name="ProdutoDetalhe" component={ProdutoDetalheTela} />
    </Stack.Navigator>
  );
}
