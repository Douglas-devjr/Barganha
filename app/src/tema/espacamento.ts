/**
 * C5.2 — Espaçamento, raios e sombras. Escala de 4px; raios e sombras seguem o
 * protótipo (cards arredondados e sombras suaves).
 */

export const espaco = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 28,
} as const;

export const raio = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/**
 * Sombras prontas (iOS via shadow*, Android via elevation). Use espalhando no
 * `style` de uma `View` branca.
 */
export const sombra = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  flutuante: {
    shadowColor: '#0F766E',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const;

export type Espaco = keyof typeof espaco;
