/**
 * Redesign "2a" — gradiente linear via `react-native-svg` (evita depender de
 * `expo-linear-gradient`, que é módulo nativo e exigiria novo dev build). Mede o
 * próprio tamanho com `onLayout` e desenha o SVG em PIXELS — porcentagem em `Svg`
 * absoluto não resolve de forma confiável e some. O ângulo segue a convenção CSS
 * (0° = para o topo, 90° = para a direita, 150° = diagonal usada no hero).
 */

import { useId, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export interface GradienteLinearProps {
  /** Cores dos stops, na ordem. */
  cores: string[];
  /** Posições 0..1 de cada stop (padrão: distribuídas). */
  locais?: number[];
  /** Ângulo em graus (convenção CSS: 0 = topo, 90 = direita). Padrão 90. */
  angulo?: number;
  raio?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/** Converte um ângulo CSS num vetor de gradiente em coordenadas 0..1 (y para baixo). */
function pontos(angulo: number) {
  const rad = (angulo * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  return {
    x1: 0.5 - dx / 2,
    y1: 0.5 - dy / 2,
    x2: 0.5 + dx / 2,
    y2: 0.5 + dy / 2,
  };
}

export function GradienteLinear({
  cores,
  locais,
  angulo = 90,
  raio,
  style,
  children,
}: GradienteLinearProps) {
  // useId() traz `:` (ex.: ":r0:"), inválido numa referência url(#id) de SVG.
  const id = 'grad' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const [tam, setTam] = useState({ l: 0, a: 0 });
  const { x1, y1, x2, y2 } = pontos(angulo);

  return (
    <View
      style={[style, raio != null && { borderRadius: raio }, estilos.recorte]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== tam.l || height !== tam.a) setTam({ l: width, a: height });
      }}
    >
      {tam.l > 0 && tam.a > 0 ? (
        <Svg style={StyleSheet.absoluteFill} width={tam.l} height={tam.a}>
          <Defs>
            <LinearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
              {cores.map((cor, i) => (
                <Stop
                  key={i}
                  offset={locais?.[i] ?? i / (cores.length - 1)}
                  stopColor={cor}
                  stopOpacity={1}
                />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={tam.l} height={tam.a} fill={`url(#${id})`} />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}

const estilos = StyleSheet.create({
  recorte: { overflow: 'hidden' },
});
