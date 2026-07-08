/**
 * Redesign "2a" (Teal Refinado sobre creme) — paleta do design system.
 *
 * Duas paletas com o MESMO conjunto de chaves: `claro` (fundo creme) e `escuro`.
 * O `ThemeContext` troca o objeto inteiro; nenhum componente deve ter hex fixo —
 * lê tudo de `useTema().c`.
 *
 * A marca é o teal `#0F766E` (mais claro no escuro para brilhar). O veredito
 * segue semáforo com a "média" na cor da marca; a promoção ("menor visto") tem
 * cor própria (âmbar) e nunca colapsa no veredito (regra travada em docs/06).
 *
 * Além dos tokens novos do handoff, cada paleta mantém ALIASES de compatibilidade
 * (nomes antigos: `marca`, `texto`, `superficie`, …) para as telas ainda não
 * migradas continuarem compilando. Ao migrar uma tela, prefira os nomes novos.
 */

export const claro = {
  // superfícies
  fundo: '#FBF5EC', // creme — fundo do app
  cartao: '#FFFCF6', // quase-branco quente — cards
  cartaoBorda: 'rgba(15,23,42,0.05)',
  linha: '#F1ECE1', // divisórias internas de card
  borda: '#E7DECE', // bordas/inputs sobre creme

  // texto
  tinta: '#0E1B24', // títulos e valores (ink)
  suave: '#54636E', // texto secundário
  fraco: '#93A4AE', // legendas/placeholder

  // marca
  teal: '#0F766E',
  tealPressed: '#0B5F58',
  tealWash: '#ECFBF7', // fundo de ícone/tile teal claro
  tealWash2: '#D3F3EC', // avatar/círculo
  tealBorda: '#B7E9E0', // borda do botão secundário
  menta: '#5EEAD4', // acento sobre teal escuro
  sobreTeal: '#052E2B', // texto sobre menta

  // hero (gradiente do CartaoEconomia)
  heroDe: '#12857C',
  heroPara: '#0B5F58',

  // veredito
  baratoBg: '#EAFBF1',
  baratoBg2: '#D7F4E1',
  baratoBorda: '#BBEAC9',
  barato: '#12A150',
  baratoTexto: '#15803D',
  medio: '#0F766E',
  caro: '#E5484D',

  // promoção / avisos
  ambar: '#E8930C',
  ambarBg: '#FCEFD3',
  ambarTexto: '#B26A05',

  branco: '#FFFFFF',

  // ---- compat (nomes antigos → valores novos) ----
  marca: '#0F766E',
  marcaForte: '#0D9488',
  marcaClara: '#5EEAD4',
  marcaBgClaro: '#ECFBF7',
  marcaBgMedio: '#D3F3EC',
  marcaBorda: '#B7E9E0',
  texto: '#0E1B24',
  textoForte: '#0B1220',
  textoSuave: '#54636E',
  textoMudo: '#93A4AE',
  placeholder: '#93A4AE',
  fundoApp: '#E7DECE',
  superficie: '#FFFCF6',
  superficieMuda: '#F1ECE1',
  bordaForte: '#E7DECE',
  naMedia: '#0F766E',
  naMediaBg: '#D3F3EC',
  caroBg: '#FDECEC',
  semDados: '#54636E',
  semDadosBg: '#F1ECE1',
  promocao: '#E8930C',
  promocaoBg: '#FCEFD3',
} as const;

/** Forma da paleta: mesmas chaves de `claro`, valores string. */
export type Paleta = { readonly [K in keyof typeof claro]: string };

export const escuro: Paleta = {
  // superfícies
  fundo: '#0E1512',
  cartao: '#18211D',
  cartaoBorda: 'rgba(255,255,255,0.08)',
  linha: 'rgba(255,255,255,0.07)',
  borda: 'rgba(255,255,255,0.12)',

  // texto
  tinta: '#EAF2EF',
  suave: '#9CB2AB',
  fraco: '#617C74',

  // marca
  teal: '#18B8A6', // teal mais claro p/ brilhar no escuro
  tealPressed: '#0F766E',
  tealWash: 'rgba(45,212,191,0.13)',
  tealWash2: 'rgba(45,212,191,0.17)',
  tealBorda: 'rgba(45,212,191,0.30)',
  menta: '#5EEAD4',
  sobreTeal: '#052E2B',

  // hero
  heroDe: '#0F766E',
  heroPara: '#0B4F49',

  // veredito
  baratoBg: 'rgba(45,212,191,0.09)',
  baratoBg2: 'rgba(45,212,191,0.09)',
  baratoBorda: 'rgba(45,212,191,0.30)',
  barato: '#34D399',
  baratoTexto: '#8AE6BE',
  medio: '#18B8A6',
  caro: '#FB7185',

  // promoção / avisos
  ambar: '#E8930C',
  ambarBg: 'rgba(232,147,12,0.15)',
  ambarTexto: '#F2B45A',

  branco: '#FFFFFF',

  // ---- compat (nomes antigos → valores do escuro) ----
  marca: '#18B8A6',
  marcaForte: '#14A99A',
  marcaClara: '#5EEAD4',
  marcaBgClaro: 'rgba(45,212,191,0.13)',
  marcaBgMedio: 'rgba(45,212,191,0.17)',
  marcaBorda: 'rgba(45,212,191,0.30)',
  texto: '#EAF2EF',
  textoForte: '#EAF2EF',
  textoSuave: '#9CB2AB',
  textoMudo: '#617C74',
  placeholder: '#617C74',
  fundoApp: '#0A0F0D',
  superficie: '#18211D',
  superficieMuda: 'rgba(255,255,255,0.07)',
  bordaForte: 'rgba(255,255,255,0.12)',
  naMedia: '#18B8A6',
  naMediaBg: 'rgba(45,212,191,0.17)',
  caroBg: 'rgba(251,113,133,0.14)',
  semDados: '#9CB2AB',
  semDadosBg: 'rgba(255,255,255,0.07)',
  promocao: '#E8930C',
  promocaoBg: 'rgba(232,147,12,0.15)',
};

/**
 * Paleta legada (estática, tema claro). Mantida para telas ainda não migradas
 * ao `useTema()`. Telas novas devem ler as cores do contexto.
 */
export const cores = claro;

export type Cor = keyof Paleta;
