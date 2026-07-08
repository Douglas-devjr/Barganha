/**
 * C5.2 — Ícones (line icons do protótipo) em react-native-svg. Mantidos como um
 * conjunto pequeno e coeso; cada um aceita tamanho e cor.
 */

import type { ReactNode } from 'react';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

import { useTema } from '@/tema';

export interface IconeProps {
  tamanho?: number;
  cor?: string;
  larguraTraco?: number;
}

interface BaseProps extends IconeProps {
  children: ReactNode;
}

function Base({ tamanho = 24, cor, larguraTraco = 2.2, children }: BaseProps) {
  const { c } = useTema();
  return (
    <Svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke={cor ?? c.tinta}
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

/** receipt — cupom fiscal (estado vazio, ícone de loja/compra). */
export function IconeRecibo(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M6 3.5h12v17l-2.2-1.4-2.2 1.4-2.2-1.4-2.2 1.4-2.2-1.4L6 20.5z" />
      <Path d="M9 8h6M9 12h6M9 16h3.5" />
    </Base>
  );
}

/** alert — triângulo de aviso (erro no cupom). */
export function IconeAlerta(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M12 3.8 2.9 19.5h18.2z" />
      <Path d="M12 10v4.2" />
      <Circle cx={12} cy={17.4} r={0.4} />
    </Base>
  );
}

/** wifiOff — sem conexão. */
export function IconeSemWifi(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M2 8.5C5 6 8.4 4.7 12 4.7c1.4 0 2.7.2 4 .6" />
      <Path d="M5 12c1.6-1.3 3.5-2.1 5.5-2.4" />
      <Path d="M8.5 15.4c1-.8 2.2-1.3 3.5-1.3" />
      <Circle cx={12} cy={19} r={0.5} />
      <Line x1={3} y1={3} x2={21} y2={21} />
    </Base>
  );
}

/** close — fechar (X). */
export function IconeFechar(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M6 6l12 12M18 6 6 18" />
    </Base>
  );
}

/** chevron — seta para avançar (drill-in). */
export function IconeChevron(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="m9.5 5 7 7-7 7" />
    </Base>
  );
}

/** barcode alternativo (leitura de código de barras). */
export function IconeCodigoBarras(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M4 6v12M7 6v12M10.5 6v12M13.5 6v12M17 6v12M20 6v12" />
    </Base>
  );
}

/** seta curta para baixo (delta / tendência de queda). */
export function IconeSetaBaixo(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M12 5v13" />
      <Polyline points="6.5 12.5 12 18 17.5 12.5" />
    </Base>
  );
}

/** seta curta para cima (delta / tendência de alta). */
export function IconeSetaCima(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M12 19V6" />
      <Polyline points="6.5 11.5 12 6 17.5 11.5" />
    </Base>
  );
}
