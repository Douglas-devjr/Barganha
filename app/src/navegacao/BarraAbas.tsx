/**
 * Redesign "3a" — barra de abas com o FAB central de scan que flutua sobre a
 * barra. 4 abas fixas (Início · Verificar · Lista · Perfil); o FAB abre a tela
 * `Scanner` (QR) do stack raiz. Cores da paleta ativa (claro/escuro).
 *
 * 3a: zero cor de marca aqui — aba ativa na tinta, inativa em `fraco`. O FAB é
 * um círculo chapado de tinta com o ícone em `sobreTeal` e anel `fundo` de 4px.
 */

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  IconeInicio,
  IconeLista,
  IconePerfil,
  IconeScan,
  IconeVerificar,
  Texto,
  type IconeProps,
} from '@/componentes';
import { espaco, raio, useTema } from '@/tema';

import type { TabParamList } from './tipos';

const META: Record<keyof TabParamList, { rotulo: string; Icone: (p: IconeProps) => ReactElement }> =
  {
    Inicio: { rotulo: 'Início', Icone: IconeInicio },
    Verificar: { rotulo: 'Verificar', Icone: IconeVerificar },
    Lista: { rotulo: 'Lista', Icone: IconeLista },
    Perfil: { rotulo: 'Perfil', Icone: IconePerfil },
  };

export function BarraAbas({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { c } = useTema();

  return (
    <View
      style={[
        estilos.container,
        {
          backgroundColor: c.cartao,
          borderTopColor: c.linha,
          paddingBottom: Math.max(insets.bottom, espaco.sm),
        },
      ]}
    >
      <View style={estilos.linha}>
        {state.routes.map((route, idx) => {
          const nome = route.name as keyof TabParamList;
          const meta = META[nome];
          const focada = state.index === idx;
          const cor = focada ? c.tinta : c.fraco;

          const aoTocar = () => {
            const evento = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focada && !evento.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          // Insere o espaço central do FAB entre a 2ª e a 3ª aba.
          const espacoCentral = idx === 2 ? <View key="gap" style={estilos.gap} /> : null;

          return (
            <View key={route.key} style={estilos.celula}>
              {espacoCentral}
              <Pressable
                onPress={aoTocar}
                accessibilityRole="button"
                accessibilityState={focada ? { selected: true } : {}}
                style={estilos.aba}
              >
                <meta.Icone tamanho={22} cor={cor} />
                <Texto peso="bold" style={[estilos.rotulo, { color: cor }]}>
                  {meta.rotulo}
                </Texto>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Pressable
        onPress={() => navigation.getParent()?.navigate('Scanner')}
        accessibilityRole="button"
        accessibilityLabel="Escanear cupom"
        style={[estilos.fab, { backgroundColor: c.tinta, borderColor: c.fundo }]}
      >
        <IconeScan tamanho={27} cor={c.sobreTeal} />
      </Pressable>
    </View>
  );
}

const estilos = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    paddingTop: 9,
    paddingHorizontal: 18,
  },
  linha: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  celula: { flexDirection: 'row', alignItems: 'flex-start' },
  gap: { width: 60 },
  aba: { alignItems: 'center', justifyContent: 'center', minWidth: 56, minHeight: 44 },
  rotulo: { fontSize: 10, marginTop: 3 },
  fab: {
    position: 'absolute',
    top: -30, // metade do FAB sobreposta à barra (handoff 3a)
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: raio.pill, // 3a: circular
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
  },
});
