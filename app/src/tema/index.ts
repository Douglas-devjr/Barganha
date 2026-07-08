/**
 * Redesign "2a" — ponto único do design system. Importe daqui:
 *   import { useTema, fontes, espaco, raio } from '@/tema';
 *
 * Telas novas leem cores de `useTema()` (tema claro/escuro). O export estático
 * `cores` (= paleta clara) segue disponível para o código ainda não migrado.
 */

import { claro } from './cores';
import { espaco, raio, sombra } from './espacamento';
import { fontes, tamanhos } from './tipografia';

export { claro, escuro, cores } from './cores';
export type { Cor, Paleta } from './cores';
export { ProvedorTema, useTema } from './ThemeContext';
export type { Tema } from './ThemeContext';
export { fontes, tamanhos } from './tipografia';
export type { PesoFonte, TamanhoTexto } from './tipografia';
export { espaco, raio, sombra } from './espacamento';
export type { Espaco } from './espacamento';

import type { Paleta } from './cores';

export type ChaveVeredito = 'barato' | 'na_media' | 'caro' | 'sem_dados';

/**
 * Mapeia o veredito de `@barganha/shared` para cores da paleta ATIVA.
 * Use `veredito(c)` dentro de um componente que já leu `const { c } = useTema()`.
 */
export function veredito(c: Paleta) {
  return {
    barato: { fg: c.barato, bg: c.baratoBg, borda: c.baratoBorda, rotulo: 'Barato' },
    na_media: { fg: c.medio, bg: c.tealWash2, borda: c.tealBorda, rotulo: 'Na média' },
    caro: { fg: c.caro, bg: c.caroBg, borda: c.caro, rotulo: 'Caro' },
    sem_dados: { fg: c.semDados, bg: c.semDadosBg, borda: c.borda, rotulo: 'Sem dados' },
  } as const;
}

/**
 * Versão estática (tema claro) do mapa de veredito. Mantida para compatibilidade
 * com telas ainda não migradas ao `useTema()`.
 */
export const coresVeredito = {
  barato: { fg: claro.barato, bg: claro.baratoBg, rotulo: 'Barato' },
  na_media: { fg: claro.medio, bg: claro.tealWash2, rotulo: 'Na média' },
  caro: { fg: claro.caro, bg: claro.caroBg, rotulo: 'Caro' },
  sem_dados: { fg: claro.semDados, bg: claro.semDadosBg, rotulo: 'Sem dados' },
} as const;

/** Objeto-tema agregado (conveniência, apenas tokens não-cromáticos). */
export const tema = { fontes, tamanhos, espaco, raio, sombra } as const;
