/**
 * C5.2 — Ícones (line icons do protótipo) em react-native-svg. Mantidos como um
 * conjunto pequeno e coeso; cada um aceita tamanho e cor.
 */

import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { cores } from '@/tema';

export interface IconeProps {
  tamanho?: number;
  cor?: string;
  larguraTraco?: number;
}

interface BaseProps extends IconeProps {
  children: ReactNode;
}

function Base({ tamanho = 24, cor = cores.texto, larguraTraco = 2.2, children }: BaseProps) {
  return (
    <Svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke={cor}
      strokeWidth={larguraTraco}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export function IconeInicio(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M3 10.7 12 3.5l9 7.2" />
      <Path d="M5.3 9.3V20h13.4V9.3" />
      <Path d="M9.7 20v-5h4.6v5" />
    </Base>
  );
}

export function IconeVerificar(p: IconeProps) {
  return (
    <Base {...p}>
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="m8.4 12 2.4 2.4 4.8-5.2" />
    </Base>
  );
}

export function IconeProdutos(p: IconeProps) {
  return (
    <Base {...p}>
      <Rect x={4} y={4} width={16} height={16} rx={3} />
      <Path d="M8 9h8M8 13h8M8 17h5" />
    </Base>
  );
}

export function IconePerfil(p: IconeProps) {
  return (
    <Base {...p}>
      <Circle cx={12} cy={8.2} r={3.7} />
      <Path d="M5.2 19.5c.7-3.3 3.4-5.1 6.8-5.1s6.1 1.8 6.8 5.1" />
    </Base>
  );
}

export function IconeScan(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M4 8.5V6a2 2 0 0 1 2-2h2.5" />
      <Path d="M20 8.5V6a2 2 0 0 0-2-2h-2.5" />
      <Path d="M4 15.5V18a2 2 0 0 0 2 2h2.5" />
      <Path d="M20 15.5V18a2 2 0 0 1-2 2h-2.5" />
      <Path d="M3.5 12h17" />
    </Base>
  );
}

export function IconeBusca(p: IconeProps) {
  return (
    <Base {...p}>
      <Circle cx={11} cy={11} r={7} />
      <Path d="m20 20-3.2-3.2" />
    </Base>
  );
}

export function IconeVoltar(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="m14.5 5-7 7 7 7" />
    </Base>
  );
}

export function IconeBarras(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M4 6v12M7.5 6v12M11 6v12M14 6v12M17 6v12M20 6v12" />
    </Base>
  );
}

export function IconeLoja(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M4.5 9.5 6 5h12l1.5 4.5" />
      <Path d="M4.5 9.5a1.9 1.9 0 0 0 3.75 0 1.9 1.9 0 0 0 3.75 0 1.9 1.9 0 0 0 3.75 0 1.9 1.9 0 0 0 3.75 0" />
      <Path d="M5.7 11.3V20h12.6v-8.7" />
      <Path d="M10 20v-4.3h4V20" />
    </Base>
  );
}

export function IconeTendenciaCima(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M5 17 13 9l4 4 5-6" />
      <Path d="M22 7h-5" />
    </Base>
  );
}

export function IconeTendenciaBaixo(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M5 7 13 15l4-4 5 6" />
      <Path d="M22 17h-5" />
    </Base>
  );
}

export function IconeTendenciaPlana(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M5 12h14" />
    </Base>
  );
}
