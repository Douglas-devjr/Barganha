/**
 * Redesign "2a" — moldura de tela. Aplica o fundo creme (ou escuro), respeita a
 * área segura e, por padrão, rola o conteúdo. Telas de captura/scan passam
 * `scroll={false}` (e o próprio fundo escuro da câmera).
 */

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { espaco, useTema } from '@/tema';

import { Texto } from './Texto';

export interface TelaProps {
  children: ReactNode;
  titulo?: string;
  scroll?: boolean;
  /** Bordas em que aplicar o inset de área segura (padrão: topo). */
  bordas?: Edge[];
  /** Cor de fundo (padrão: fundo do tema ativo). */
  fundo?: string;
}

export function Tela({ children, titulo, scroll = true, bordas = ['top'], fundo }: TelaProps) {
  const { c } = useTema();
  const conteudo = (
    <>
      {titulo ? (
        <Texto peso="extrabold" tamanho="titulo" style={estilos.titulo}>
          {titulo}
        </Texto>
      ) : null}
      {children}
    </>
  );

  return (
    <SafeAreaView edges={bordas} style={[estilos.raiz, { backgroundColor: fundo ?? c.fundo }]}>
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
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1 },
  scroll: { paddingHorizontal: espaco.xl, paddingTop: espaco.sm, paddingBottom: espaco.xxl },
  fixo: { flex: 1, paddingHorizontal: espaco.xl, paddingTop: espaco.sm },
  titulo: { marginBottom: espaco.lg, letterSpacing: -0.4 },
});
