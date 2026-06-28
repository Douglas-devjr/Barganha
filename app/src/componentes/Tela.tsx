/**
 * C5.2 — Moldura de tela. Aplica o fundo do app, respeita a área segura e, por
 * padrão, rola o conteúdo. Telas de captura/scan passam `scroll={false}`.
 */

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { cores, espaco } from '@/tema';

import { Texto } from './Texto';

export interface TelaProps {
  children: ReactNode;
  titulo?: string;
  scroll?: boolean;
  /** Bordas em que aplicar o inset de área segura (padrão: topo). */
  bordas?: Edge[];
  /** Cor de fundo (padrão: fundo claro do app). */
  fundo?: string;
}

export function Tela({
  children,
  titulo,
  scroll = true,
  bordas = ['top'],
  fundo = cores.fundo,
}: TelaProps) {
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
    <SafeAreaView edges={bordas} style={[estilos.raiz, { backgroundColor: fundo }]}>
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
