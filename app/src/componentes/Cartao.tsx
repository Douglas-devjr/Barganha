/**
 * Redesign "2a" — cartão creme (`cartao`) com borda fina (`cartaoBorda`), cantos
 * arredondados e sombra difusa. Base visual de quase todas as telas. No escuro a
 * sombra some e a separação vem da borda (ver ThemeContext).
 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { espaco, raio, sombra, useTema } from '@/tema';

export interface CartaoProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Remove o padding interno (para listas que controlam o próprio espaçamento). */
  semPadding?: boolean;
}

export function Cartao({ children, style, semPadding = false }: CartaoProps) {
  const { c, escuro } = useTema();
  return (
    <View
      style={[
        estilos.base,
        {
          backgroundColor: c.cartao,
          borderColor: c.cartaoBorda,
          ...(escuro ? {} : sombra.card),
        },
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
