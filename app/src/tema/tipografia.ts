/**
 * C5.2 — Tipografia. Redesign "3a": família única Instrument Sans (carregada no
 * App via @expo-google-fonts). As chaves de `fontes` batem com os nomes
 * registrados pelo pacote; use-as como `fontFamily`.
 *
 * Instrument Sans vai só até 700 — `extrabold` aponta para o bold (não existe
 * 800). A chave é mantida para as telas que já a usam.
 */

import type { TextStyle } from 'react-native';

export const fontes = {
  regular: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
  extrabold: 'InstrumentSans_700Bold', // Instrument Sans não tem 800
} as const;

/** Escala tipográfica do 3a (mais alta no topo que a do 2a). */
export const tamanhos = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  titulo: 26,
  display: 40,
} as const;

/**
 * Números alinhados por coluna. Aplicar em TODO texto de preço/estatística
 * (`style={tabular}`), como manda o handoff 3a.
 */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export type PesoFonte = keyof typeof fontes;
export type TamanhoTexto = keyof typeof tamanhos;
