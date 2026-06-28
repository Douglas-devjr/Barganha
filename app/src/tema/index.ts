/**
 * C5.2 — Ponto único do design system. Importe daqui:
 *   import { cores, fontes, espaco, raio, tema } from '@/tema';
 */

import { cores } from './cores';
import { espaco, raio, sombra } from './espacamento';
import { fontes, tamanhos } from './tipografia';

export { cores } from './cores';
export type { Cor } from './cores';
export { fontes, tamanhos } from './tipografia';
export type { PesoFonte, TamanhoTexto } from './tipografia';
export { espaco, raio, sombra } from './espacamento';
export type { Espaco } from './espacamento';

/** Mapeia o veredito de `@barganha/shared` para cores do design system. */
export const coresVeredito = {
  barato: { fg: cores.barato, bg: cores.baratoBg, rotulo: 'Barato' },
  na_media: { fg: cores.naMedia, bg: cores.naMediaBg, rotulo: 'Na média' },
  caro: { fg: cores.caro, bg: cores.caroBg, rotulo: 'Caro' },
  sem_dados: { fg: cores.semDados, bg: cores.semDadosBg, rotulo: 'Sem dados' },
} as const;

/** Objeto-tema agregado (conveniência). */
export const tema = { cores, fontes, tamanhos, espaco, raio, sombra } as const;
