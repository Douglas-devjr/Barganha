/**
 * C5.2 — Paleta do design system (direção "Leve" do protótipo).
 *
 * A marca é o teal `#0F766E`. As cores de veredito seguem semáforo, mas com a
 * "média" na cor da marca (on-brand) em vez de amarelo:
 *   • barato  → verde   • na média → teal   • caro → vermelho   • sem dados → slate
 * A promoção ("menor visto") tem cor própria (âmbar) e nunca colapsa no veredito
 * (regra travada em docs/06 e refletida em @barganha/shared/estatistica).
 */

export const cores = {
  // Marca
  marca: '#0F766E',
  marcaForte: '#0D9488',
  marcaClara: '#5EEAD4',
  marcaBgClaro: '#F0FDFA',
  marcaBgMedio: '#CCFBF1',
  marcaBorda: '#99F6E4',

  // Texto
  texto: '#0F172A',
  textoForte: '#0B1220',
  textoSuave: '#475569',
  textoMudo: '#64748B',
  placeholder: '#94A3B8',

  // Superfícies
  fundo: '#F8FAFC',
  fundoApp: '#E2E8F0',
  superficie: '#FFFFFF',
  superficieMuda: '#F1F5F9',
  borda: '#EEF2F6',
  bordaForte: '#CBD5E1',

  // Veredito (faixa típica)
  barato: '#16A34A',
  baratoBg: '#DCFCE7',
  naMedia: '#0F766E',
  naMediaBg: '#CCFBF1',
  caro: '#DC2626',
  caroBg: '#FEE2E2',
  semDados: '#64748B',
  semDadosBg: '#F1F5F9',

  // Promoção ("menor visto") — sempre à parte do veredito
  promocao: '#F59E0B',
  promocaoBg: '#FEF3C7',

  branco: '#FFFFFF',
} as const;

export type Cor = keyof typeof cores;
