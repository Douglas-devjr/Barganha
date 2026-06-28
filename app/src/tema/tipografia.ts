/**
 * C5.2 — Tipografia. Fonte Plus Jakarta Sans (carregada no App via
 * @expo-google-fonts). As chaves de `fontes` batem com os nomes registrados
 * pelo pacote; use-as como `fontFamily`.
 */

export const fontes = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

/** Escala tipográfica derivada do protótipo. */
export const tamanhos = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  titulo: 22,
  display: 28,
} as const;

export type PesoFonte = keyof typeof fontes;
export type TamanhoTexto = keyof typeof tamanhos;
