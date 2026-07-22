/**
 * Redesign "3a" — moldura de tela. Aplica o fundo neutro (ou escuro), respeita a
 * área segura e, por padrão, rola o conteúdo. Telas de captura/scan passam
 * `scroll={false}` (e o próprio fundo escuro da câmera).
 *
 * Toda tela entra com o `scrIn` do handoff: fade + 10px de subida em 280ms.
 * Como a animação mora aqui, nenhuma tela precisa repeti-la — e ela some sozinha
 * quando o sistema pede "reduzir movimento" (o estado final é o mesmo).
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, ScrollView, StyleSheet, View } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { espaco, useTema } from '@/tema';

import { DURACAO, useDuracao } from './movimento';
import { Texto } from './Texto';

export interface TelaProps {
  children: ReactNode;
  titulo?: string;
  scroll?: boolean;
  /** Bordas em que aplicar o inset de área segura (padrão: topo). */
  bordas?: Edge[];
  /** Cor de fundo (padrão: fundo do tema ativo). */
  fundo?: string;
  /** Desliga o `scrIn` (para telas que já animam por conta própria). */
  semEntrada?: boolean;
}

export function Tela({
  children,
  titulo,
  scroll = true,
  bordas = ['top'],
  fundo,
  semEntrada = false,
}: TelaProps) {
  const { c } = useTema();
  const conteudo = (
    <>
      {titulo ? (
        <Texto peso="bold" tamanho="titulo" style={estilos.titulo}>
          {titulo}
        </Texto>
      ) : null}
      {children}
    </>
  );

  return (
    <SafeAreaView edges={bordas} style={[estilos.raiz, { backgroundColor: fundo ?? c.fundo }]}>
      <EntradaTela desligada={semEntrada}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={estilos.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {conteudo}
          </ScrollView>
        ) : (
          <View style={estilos.fixo}>{conteudo}</View>
        )}
      </EntradaTela>
    </SafeAreaView>
  );
}

/** `scrIn` do handoff: opacidade 0→1 e translateY 10→0 em 280ms. */
function EntradaTela({ children, desligada }: { children: ReactNode; desligada: boolean }) {
  const duracao = useDuracao(DURACAO.tela);
  const anim = useRef(new Animated.Value(desligada ? 1 : 0)).current;

  useEffect(() => {
    if (desligada) return;
    Animated.timing(anim, { toValue: 1, duration: duracao, useNativeDriver: true }).start();
  }, [anim, duracao, desligada]);

  if (desligada) return <View style={estilos.raiz}>{children}</View>;

  return (
    <Animated.View
      style={[
        estilos.raiz,
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1 },
  scroll: { paddingHorizontal: espaco.tela, paddingTop: espaco.sm, paddingBottom: espaco.xxl },
  fixo: { flex: 1, paddingHorizontal: espaco.tela, paddingTop: espaco.sm },
  titulo: { marginBottom: espaco.lg, letterSpacing: -0.8 },
});
