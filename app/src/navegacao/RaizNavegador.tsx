/**
 * C5.1 — Stack raiz do APP autenticado: as abas + as telas de fluxo (scan, nota
 * fiscal, detalhe do produto). O `Scanner` abre como modal (vindo do FAB). Só é
 * montado quando há sessão (C4.3.1); o consentimento (onboarding) e o login são
 * gates ANTERIORES, resolvidos em App.tsx.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ConquistasTela } from '@/telas/ConquistasTela';
import { DashboardTela } from '@/telas/DashboardTela';
import { EditarProdutoTela } from '@/telas/EditarProdutoTela';
import { EscanearBarrasTela } from '@/telas/EscanearBarrasTela';
import { ListaComprasTela } from '@/telas/ListaComprasTela';
import { NotaFiscalTela } from '@/telas/NotaFiscalTela';
import { NotificacoesTela } from '@/telas/NotificacoesTela';
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
      <Stack.Screen name="ListaCompras" component={ListaComprasTela} />
      <Stack.Screen name="Notificacoes" component={NotificacoesTela} />
      <Stack.Screen name="Conquistas" component={ConquistasTela} />
      <Stack.Screen name="Dashboard" component={DashboardTela} />
      <Stack.Screen
        name="EditarProduto"
        component={EditarProdutoTela}
        options={{ presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
