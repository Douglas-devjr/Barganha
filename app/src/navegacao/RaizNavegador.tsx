/**
 * C5.1 — Stack raiz do APP autenticado: as abas + as telas de fluxo (scan, nota
 * fiscal, detalhe do produto, ajustes). O `Scanner` abre como modal (vindo do
 * FAB). Só é montado quando há sessão (C4.3.1); o consentimento (onboarding), o
 * login e a abertura (boas-vindas + permissões) são gates ANTERIORES,
 * resolvidos em App.tsx.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AjudaTela } from '@/telas/AjudaTela';
import { AlertasTela } from '@/telas/AlertasTela';
import { CompararMercadosTela } from '@/telas/CompararMercadosTela';
import { ComprasTela } from '@/telas/ComprasTela';
import { ConfiguracoesContaTela } from '@/telas/ConfiguracoesContaTela';
import { ConquistaDetalheTela } from '@/telas/ConquistaDetalheTela';
import { ConquistasTela } from '@/telas/ConquistasTela';
import { CupomLidoTela } from '@/telas/CupomLidoTela';
import { DashboardTela } from '@/telas/DashboardTela';
import { DigitarChaveTela } from '@/telas/DigitarChaveTela';
import { EditarProdutoTela } from '@/telas/EditarProdutoTela';
import { EditarRegiaoTela } from '@/telas/EditarRegiaoTela';
import { EscanearBarrasTela } from '@/telas/EscanearBarrasTela';
import { LancamentoManualTela } from '@/telas/LancamentoManualTela';
import { NotaFiscalTela } from '@/telas/NotaFiscalTela';
import { NotificacoesTela } from '@/telas/NotificacoesTela';
import { ProdutoDetalheTela } from '@/telas/ProdutoDetalheTela';
import { ProdutosTela } from '@/telas/ProdutosTela';
import { ScannerTela } from '@/telas/ScannerTela';
import { SemConexaoTela } from '@/telas/SemConexaoTela';

import { AbasNavegador } from './AbasNavegador';
import type { RootStackParamList } from './tipos';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RaizNavegador() {
  return (
    <Stack.Navigator initialRouteName="Abas" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Abas" component={AbasNavegador} />

      {/* captura */}
      <Stack.Screen name="Scanner" component={ScannerTela} options={{ presentation: 'modal' }} />
      <Stack.Screen
        name="EscanearBarras"
        component={EscanearBarrasTela}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="DigitarChave" component={DigitarChaveTela} />
      <Stack.Screen name="CupomLido" component={CupomLidoTela} />
      <Stack.Screen name="NotaFiscal" component={NotaFiscalTela} />

      {/* histórico e produtos */}
      <Stack.Screen name="Compras" component={ComprasTela} />
      <Stack.Screen name="Produtos" component={ProdutosTela} />
      <Stack.Screen name="ProdutoDetalhe" component={ProdutoDetalheTela} />
      <Stack.Screen name="CompararMercados" component={CompararMercadosTela} />
      <Stack.Screen name="Dashboard" component={DashboardTela} />
      <Stack.Screen
        name="EditarProduto"
        component={EditarProdutoTela}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="LancamentoManual"
        component={LancamentoManualTela}
        options={{ presentation: 'modal' }}
      />

      {/* perfil e ajustes */}
      <Stack.Screen name="Notificacoes" component={NotificacoesTela} />
      <Stack.Screen name="Conquistas" component={ConquistasTela} />
      <Stack.Screen name="ConquistaDetalhe" component={ConquistaDetalheTela} />
      <Stack.Screen name="Alertas" component={AlertasTela} />
      <Stack.Screen name="ConfiguracoesConta" component={ConfiguracoesContaTela} />
      <Stack.Screen name="EditarRegiao" component={EditarRegiaoTela} />
      <Stack.Screen name="Ajuda" component={AjudaTela} />
      <Stack.Screen name="SemConexao" component={SemConexaoTela} />
    </Stack.Navigator>
  );
}
