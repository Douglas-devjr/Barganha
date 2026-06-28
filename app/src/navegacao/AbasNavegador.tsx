/**
 * C5.1 — Navegador de abas (Início · Verificar · Produtos · Perfil). O header é
 * desligado; cada tela desenha o próprio título via `<Tela titulo>`. A barra é a
 * customizada (BarraAbas), com o botão central de scan.
 */

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { InicioTela } from '@/telas/InicioTela';
import { PerfilTela } from '@/telas/PerfilTela';
import { ProdutosTela } from '@/telas/ProdutosTela';
import { VerificarTela } from '@/telas/VerificarTela';

import { BarraAbas } from './BarraAbas';
import type { TabParamList } from './tipos';

const Tab = createBottomTabNavigator<TabParamList>();

export function AbasNavegador() {
  return (
    <Tab.Navigator
      tabBar={(props) => <BarraAbas {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Inicio" component={InicioTela} />
      <Tab.Screen name="Verificar" component={VerificarTela} />
      <Tab.Screen name="Produtos" component={ProdutosTela} />
      <Tab.Screen name="Perfil" component={PerfilTela} />
    </Tab.Navigator>
  );
}
