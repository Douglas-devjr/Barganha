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

/** pino de mapa — região escolhida (nunca GPS: é escolha manual). */
export function IconePino(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" />
      <Circle cx="12" cy="10" r="2.5" />
    </Base>
  );
}

/** sol — controle de tema (claro/escuro). */
export function IconeTema(p: IconeProps) {
  return (
    <Base {...p}>
      <Circle cx="12" cy="12" r="4" />
      <Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Base>
  );
}

/** cadeado — privacidade dos dados. */
export function IconeCadeado(p: IconeProps) {
  return (
    <Base {...p}>
      <Rect x="4" y="10" width="16" height="11" rx="2" />
      <Path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Base>
  );
}

/** lixeira — ação destrutiva (excluir conta). */
export function IconeLixeira(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M3 6h18" />
      <Path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Base>
  );
}

/** kebab (⋮) — abre o sheet de ações do item. */
export function IconeKebab(p: IconeProps) {
  return (
    <Base {...p}>
      <Circle cx="12" cy="5" r="1.4" />
      <Circle cx="12" cy="12" r="1.4" />
      <Circle cx="12" cy="19" r="1.4" />
    </Base>
  );
}

/** funil — filtrar e ordenar. */
export function IconeFiltro(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M3.5 5.5h17l-6.6 7.7v5.6l-3.8 1.7v-7.3L3.5 5.5Z" />
    </Base>
  );
}

/** check — item escolhido na ordenação. */
export function IconeCheck(p: IconeProps) {
  return (
    <Base {...p}>
      <Polyline points="4.5 12.5 9.5 17.5 19.5 6.5" />
    </Base>
  );
}

/** sino — feed de notificações (o ponto de não-lida fica por conta de quem usa). */
export function IconeSino(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" />
      <Path d="M13.7 19.5a2 2 0 0 1-3.4 0" />
    </Base>
  );
}

/** troféu — conquistas e selos de contribuição. */
export function IconeTrofeu(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M7 4h10v6a5 5 0 0 1-10 0V4Z" />
      <Path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11" />
      <Path d="M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" />
      <Path d="M12 15v3.5M8.5 20.5h7" />
    </Base>
  );
}

/** olho aberto — revelar senha. */
export function IconeOlho(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <Circle cx={12} cy={12} r={3} />
    </Base>
  );
}

/** olho cortado — senha oculta. */
export function IconeOlhoFechado(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M9.9 5.8A9.3 9.3 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.6" />
      <Path d="M6.2 7.7A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-1" />
      <Path d="M10 10a2.8 2.8 0 0 0 4 4" />
      <Line x1={3.5} y1={3.5} x2={20.5} y2={20.5} />
    </Base>
  );
}

/** bandeira — denunciar preço incorreto. */
export function IconeBandeira(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M5 21V4" />
      <Path d="M5 4.5h10.5l-1.6 3.5 1.6 3.5H5" />
    </Base>
  );
}

/** coroa — selo de topo ("lenda do mercado"). */
export function IconeCoroa(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M4 8.5l3.2 3L12 5l4.8 6.5L20 8.5l-1.6 9.5H5.6L4 8.5Z" />
      <Path d="M5.6 20.5h12.8" />
    </Base>
  );
}

/** chama — sequência de semanas contribuindo ("no ritmo"). */
export function IconeChama(p: IconeProps) {
  return (
    <Base {...p}>
      <Path d="M12 3.5s5.5 4.2 5.5 9a5.5 5.5 0 0 1-11 0c0-2 1-3.6 2-4.8.4 1.3 1.3 2.1 2.2 2.3-.6-2.4.2-4.9 1.3-6.5Z" />
    </Base>
  );
}

/** calendário — marcos por período ("semana cheia"). */
export function IconeCalendario(p: IconeProps) {
  return (
    <Base {...p}>
      <Rect x={3.5} y={5} width={17} height={15.5} rx={2.5} />
      <Path d="M3.5 9.5h17" />
      <Path d="M8 3.5v3M16 3.5v3" />
    </Base>
  );
}
