/**
 * C5.1 — Barra de abas customizada com o botão central de scan (FAB) que flutua
 * sobre a barra, como no protótipo. As 4 abas são fixas; o FAB abre a tela
 * `Scanner` do stack raiz.
 */

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  IconeInicio,
  IconePerfil,
  IconeProdutos,
  IconeScan,
  IconeVerificar,
  Texto,
  type IconeProps,
} from '@/componentes';
import { cores, espaco, raio, sombra } from '@/tema';

import type { TabParamList } from './tipos';

const META: Record<keyof TabParamList, { rotulo: string; Icone: (p: IconeProps) => ReactElement }> =
  {
    Inicio: { rotulo: 'Início', Icone: IconeInicio },
    Verificar: { rotulo: 'Verificar', Icone: IconeVerificar },
    Produtos: { rotulo: 'Produtos', Icone: IconeProdutos },
    Perfil: { rotulo: 'Perfil', Icone: IconePerfil },
  };

export function BarraAbas({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[estilos.container, { paddingBottom: Math.max(insets.bottom, espaco.sm) }]}>
      <View style={estilos.linha}>
        {state.routes.map((route, idx) => {
          const nome = route.name as keyof TabParamList;
          const meta = META[nome];
          const focada = state.index === idx;
          const cor = focada ? cores.marca : cores.placeholder;

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
                <meta.Icone tamanho={24} cor={cor} />
                <Texto peso="bold" tamanho="xs" style={{ color: cor, marginTop: 2 }}>
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
        style={estilos.fab}
      >
        <IconeScan tamanho={27} cor={cores.branco} />
      </Pressable>
    </View>
  );
}

const estilos = StyleSheet.create({
  container: {
    backgroundColor: cores.superficie,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
    paddingTop: 9,
    paddingHorizontal: 18,
  },
  linha: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  celula: { flexDirection: 'row', alignItems: 'flex-start' },
  gap: { width: 60 },
  aba: { alignItems: 'center', justifyContent: 'center', minWidth: 56 },
  fab: {
    position: 'absolute',
    top: -24,
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: raio.xl,
    backgroundColor: cores.marca,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: cores.fundo,
    ...sombra.flutuante,
  },
});
