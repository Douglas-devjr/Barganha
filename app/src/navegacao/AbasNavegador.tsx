/**
 * C5.1 + handoff 3a — Navegador de abas (Início · Verificar · Lista · Perfil). O
 * header é desligado; cada tela desenha o próprio título via `<Tela titulo>`. A
 * barra é a customizada (BarraAbas), com o botão central de scan.
 *
 * "Produtos" saiu da barra e virou tela de stack: quem monta a compra usa a
 * Lista todo dia; o catálogo é consulta e continua a um toque dela.
 */

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { InicioTela } from '@/telas/InicioTela';
import { ListaComprasTela } from '@/telas/ListaComprasTela';
import { PerfilTela } from '@/telas/PerfilTela';
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
      <Tab.Screen name="Lista" component={ListaComprasTela} />
      <Tab.Screen name="Perfil" component={PerfilTela} />
    </Tab.Navigator>
  );
}
