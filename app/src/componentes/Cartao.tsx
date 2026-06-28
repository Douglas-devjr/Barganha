/**
 * C5.2 — Cartão branco com sombra suave e cantos arredondados (base visual de
 * quase todas as telas do protótipo).
 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { cores, espaco, raio, sombra } from '@/tema';

export interface CartaoProps {
  children: ReactNode;
  style?: ViewStyle;
  /** Remove o padding interno (para listas que controlam o próprio espaçamento). */
  semPadding?: boolean;
}

export function Cartao({ children, style, semPadding = false }: CartaoProps) {
  return <View style={[estilos.base, semPadding && estilos.semPadding, style]}>{children}</View>;
}

const estilos = StyleSheet.create({
  base: {
    backgroundColor: cores.superficie,
    borderRadius: raio.xl,
    borderWidth: 1,
    borderColor: cores.superficieMuda,
    padding: espaco.lg,
    ...sombra.card,
  },
  semPadding: { padding: 0 },
});
