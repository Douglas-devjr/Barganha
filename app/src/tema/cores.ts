/**
 * Redesign "3a" (Neutra/minimalista) — paleta do design system.
 *
 * Duas paletas com o MESMO conjunto de chaves: `claro` (canvas neutro) e
 * `escuro`. O `ThemeContext` troca o objeto inteiro; nenhum componente deve ter
 * hex fixo — lê tudo de `useTema().c`.
 *
 * A marca do 3a é a própria TINTA (quase-preto no claro, quase-branco no
 * escuro): a navegação não tem cor. A cor entra só no semáforo do veredito
 * (verde = barato, âmbar = na média, vermelho = caro) e nos indicadores de
 * variação. A promoção ("menor visto") mantém o âmbar próprio e nunca colapsa
 * no veredito (regra travada em docs/06).
 *
 * ATENÇÃO ao migrar do 2a: `teal`/`marca` deixaram de ser um tom médio e agora
 * são a tinta, que INVERTE entre os temas. Texto/ícone sobre o primário deve
 * usar `sobreTeal` (= chipink), nunca `branco` — no escuro o primário é claro e
 * branco sobre branco some.
 *
 * Cada paleta mantém ALIASES de compatibilidade (nomes antigos: `marca`,
 * `texto`, `superficie`, …) apontando para os mesmos valores das chaves-mãe.
 */

export const claro = {
  // superfícies
  fundo: '#F7F7F5', // bg — canvas neutro
  cartao: '#FFFFFF', // card
  cartaoBorda: '#E7E7E3', // line
  linha: '#F0F0EC', // line2 — divisórias internas, trilhos
  borda: '#E7E7E3', // line — bordas/inputs

  // texto
  tinta: '#1B1B19', // ink
  suave: '#6B6B66', // sub
  fraco: '#A3A39D', // faint

  // marca = tinta (o 3a não tem cor de marca)
  teal: '#1B1B19', // chip — botão/pill primário
  tealPressed: '#000000',
  tealWash: '#F0F0EC', // line2 — tile/ícone
  tealWash2: '#EDEDE8', // avatar/círculo
  tealBorda: '#E7E7E3', // line
  menta: '#1B1B19', // acento → tinta (sem verde)
  sobreTeal: '#FFFFFF', // chipink — texto sobre o primário

  // hero (CartaoEconomia) — monocromático
  heroDe: '#1B1B19',
  heroPara: '#000000',

  // veredito — semáforo
  baratoBg: '#EAF6EE',
  baratoBg2: '#EAF6EE',
  baratoBorda: '#C9EBD4',
  barato: '#16A34A', // down
  baratoTexto: '#16A34A',
  medio: '#D97706', // mid — ÂMBAR (não é mais a cor de marca)
  caro: '#DC2626', // up

  // promoção / avisos
  ambar: '#D97706',
  ambarBg: '#FBF1DC',
  ambarTexto: '#B26A05',

  branco: '#FFFFFF',
  /** Véu atrás de bottom-sheets e diálogos (escuro nos dois temas, de propósito). */
  veu: 'rgba(0,0,0,0.5)',

  // ---- compat (nomes antigos → valores 3a) ----
  marca: '#1B1B19',
  marcaForte: '#000000',
  marcaClara: '#F0F0EC',
  marcaBgClaro: '#F0F0EC',
  marcaBgMedio: '#EDEDE8',
  marcaBorda: '#E7E7E3',
  texto: '#1B1B19',
  textoForte: '#1B1B19',
  textoSuave: '#6B6B66',
  textoMudo: '#A3A39D',
  placeholder: '#A3A39D',
  fundoApp: '#F7F7F5',
  superficie: '#FFFFFF', // fld — fundo de input
  superficieMuda: '#F0F0EC',
  bordaForte: '#E7E7E3',
  naMedia: '#D97706', // mid
  naMediaBg: '#FBF1DC',
  caroBg: '#FBEAE9',
  semDados: '#6B6B66',
  semDadosBg: '#F0F0EC',
  promocao: '#D97706',
  promocaoBg: '#FBF1DC',
} as const;

/** Forma da paleta: mesmas chaves de `claro`, valores string. */
export type Paleta = { readonly [K in keyof typeof claro]: string };

export const escuro: Paleta = {
  // superfícies
  fundo: '#111110',
  cartao: '#191918',
  cartaoBorda: 'rgba(255,255,255,0.12)',
  linha: 'rgba(255,255,255,0.08)',
  borda: 'rgba(255,255,255,0.12)',

  // texto
  tinta: '#F0F0EE',
  suave: '#8F8F8A',
  fraco: '#8F8F8A',

  // marca = tinta (clara sobre escuro)
  teal: '#F0F0EE',
  tealPressed: '#FFFFFF',
  tealWash: 'rgba(255,255,255,0.08)',
  tealWash2: 'rgba(255,255,255,0.12)',
  tealBorda: 'rgba(255,255,255,0.12)',
  menta: '#F0F0EE',
  sobreTeal: '#111110', // texto escuro sobre o primário claro

  // hero — monocromático
  heroDe: '#F0F0EE',
  heroPara: '#D8D8D4',

  // veredito — semáforo
  baratoBg: 'rgba(74,222,128,0.10)',
  baratoBg2: 'rgba(74,222,128,0.10)',
  baratoBorda: 'rgba(74,222,128,0.28)',
  barato: '#4ADE80',
  baratoTexto: '#4ADE80',
  medio: '#E8A33C', // mid — âmbar
  caro: '#F87171',

  // promoção / avisos
  ambar: '#E8A33C',
  ambarBg: 'rgba(232,163,60,0.12)',
  ambarTexto: '#E8A33C',

  branco: '#FFFFFF',
  veu: 'rgba(0,0,0,0.6)',

  // ---- compat (nomes antigos → valores do escuro 3a) ----
  marca: '#F0F0EE',
  marcaForte: '#FFFFFF',
  marcaClara: 'rgba(255,255,255,0.08)',
  marcaBgClaro: 'rgba(255,255,255,0.08)',
  marcaBgMedio: 'rgba(255,255,255,0.12)',
  marcaBorda: 'rgba(255,255,255,0.12)',
  texto: '#F0F0EE',
  textoForte: '#F0F0EE',
  textoSuave: '#8F8F8A',
  textoMudo: '#8F8F8A',
  placeholder: '#8F8F8A',
  fundoApp: '#111110',
  superficie: '#191918', // fld
  superficieMuda: 'rgba(255,255,255,0.08)',
  bordaForte: 'rgba(255,255,255,0.12)',
  naMedia: '#E8A33C',
  naMediaBg: 'rgba(232,163,60,0.12)',
  caroBg: 'rgba(248,113,113,0.12)',
  semDados: '#8F8F8A',
  semDadosBg: 'rgba(255,255,255,0.08)',
  promocao: '#E8A33C',
  promocaoBg: 'rgba(232,163,60,0.12)',
};

/**
 * Paleta legada (estática, tema claro). Mantida para telas ainda não migradas
 * ao `useTema()`. Telas novas devem ler as cores do contexto.
 */
export const cores = claro;

export type Cor = keyof Paleta;

/**
 * Aplica alfa a uma cor da paleta — para véus e overlays que antes eram
 * `rgba(255,255,255,…)` fixo. Como o 3a inverte (o que está "por cima" do
 * primário é branco no claro e quase-preto no escuro), o overlay tem que sair
 * de um token e não de branco fixo.
 *
 *   comAlfa(c.sobreTeal, 0.16)  →  'rgba(255,255,255,0.16)' | 'rgba(17,17,16,0.16)'
 *
 * Aceita `#RGB`, `#RRGGBB` e `rgb()/rgba()` (nesse caso troca o alfa).
 */
export function comAlfa(cor: string, alfa: number): string {
  const rgba = cor.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgba) return `rgba(${rgba[1]},${rgba[2]},${rgba[3]},${alfa})`;

  let hex = cor.replace('#', '');
  if (hex.length === 3) hex = hex.replace(/./g, (d) => d + d);
  if (hex.length !== 6) return cor; // formato desconhecido: devolve como veio

  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
}
