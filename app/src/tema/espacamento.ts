/**
 * Redesign "2a" — espaçamento, raios e sombras. Escala de 4px; raios e sombras
 * seguem o handoff (cards arredondados, sombra de cartão bem difusa, FAB teal).
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
  sm: 12, // tiles
  md: 14, // inputs
  botao: 15,
  lg: 16,
  cartao: 20,
  xl: 22,
  hero: 26, // hero / painel de veredito
  pill: 999,
} as const;

/**
 * Sombras prontas (iOS via shadow*, Android via elevation).
 * No escuro, prefira a borda `cartaoBorda` a sombra (ver ThemeContext).
 */
export const sombra = {
  /** Cartão creme: bem difusa e suave. */
  card: {
    shadowColor: '#3C2D14',
    shadowOpacity: 0.06,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 2,
  },
  /** Botão primário / FAB: teal com brilho. */
  flutuante: {
    shadowColor: '#0F766E',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const;

export type Espaco = keyof typeof espaco;
