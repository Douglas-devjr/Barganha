/**
 * Redesign "3a" — espaçamento, raios e sombras. Escala de 4px; raios seguem o
 * handoff (cards 16, botões/inputs 12, pills 999, bottom-sheet 22 no topo).
 *
 * O 3a é FLAT: as superfícies são definidas por `cartaoBorda`/`linha`, não por
 * sombra. `sombra.card` e `sombra.flutuante` viraram no-ops para não quebrar as
 * telas que já as espalham — a única sombra permitida é a do bottom-sheet.
 */

export const espaco = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  /** Padding horizontal padrão das telas no 3a. */
  tela: 20,
  xl: 22,
  xxl: 28,
} as const;

export const raio = {
  sm: 10, // ícone-quadrado
  md: 12, // botões / inputs
  botao: 12,
  lg: 16, // cards
  cartao: 16,
  xl: 22, // bottom-sheet (topo)
  hero: 16,
  pill: 999, // pills / switch / avatar / chips
} as const;

/**
 * 3a é flat: sem sombra nas superfícies. `card` e `flutuante` ficam vazias de
 * propósito (mantidas só para não quebrar os `...sombra.x` espalhados pelas
 * telas). A única sombra do design é a do bottom-sheet.
 */
export const sombra = {
  /** No-op — o 3a define cartão por borda, não por sombra. */
  card: {},
  /** No-op — o FAB do 3a é chapado, sem glow. */
  flutuante: {},
  /** Leve sombra superior do bottom-sheet (o único caso permitido). */
  folha: {
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
} as const;

export type Espaco = keyof typeof espaco;
