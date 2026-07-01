/**
 * C5.1 — Stack raiz do APP autenticado: as abas + as telas de fluxo (scan, nota
 * fiscal, detalhe do produto). O `Scanner` abre como modal (vindo do FAB). Só é
 * montado quando há sessão (C4.3.1); o consentimento (onboarding) e o login são
 * gates ANTERIORES, resolvidos em App.tsx.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { EscanearBarrasTela } from '@/telas/EscanearBarrasTela';
import { NotaFiscalTela } from '@/telas/NotaFiscalTela';
import { ProdutoDetalheTela } from '@/telas/ProdutoDetalheTela';
import { ScannerTela } from '@/telas/ScannerTela';

import { AbasNavegador } from './AbasNavegador';
import type { RootStackParamList } from './tipos';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RaizNavegador() {
  return (
    <Stack.Navigator initialRouteName="Abas" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Abas" component={AbasNavegador} />
      <Stack.Screen name="Scanner" component={ScannerTela} options={{ presentation: 'modal' }} />
      <Stack.Screen
        name="EscanearBarras"
        component={EscanearBarrasTela}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="NotaFiscal" component={NotaFiscalTela} />
      <Stack.Screen name="ProdutoDetalhe" component={ProdutoDetalheTela} />
    </Stack.Navigator>
  );
}
