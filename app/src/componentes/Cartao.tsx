/**
 * Redesign "3a" — cartão (`cartao`) com borda fina (`cartaoBorda`) e cantos de
 * 16px. Base visual de quase todas as telas. O 3a é flat: a separação vem
 * SEMPRE da borda, nos dois temas — não há sombra de cartão.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { espaco, raio, useTema } from '@/tema';

export interface CartaoProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Remove o padding interno (para listas que controlam o próprio espaçamento). */
  semPadding?: boolean;
}

export function Cartao({ children, style, semPadding = false }: CartaoProps) {
  const { c } = useTema();
  return (
    <View
      style={[
        estilos.base,
        { backgroundColor: c.cartao, borderColor: c.cartaoBorda },
        semPadding && estilos.semPadding,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const estilos = StyleSheet.create({
  base: {
    borderRadius: raio.cartao,
    borderWidth: 1,
    padding: espaco.lg,
  },
  semPadding: { padding: 0 },
});
