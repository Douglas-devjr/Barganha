/**
 * Redesign "2a" — moldura de mira das telas de câmera (QR e código de barras).
 * Cantos em menta + uma linha de scan com glow que varre verticalmente. Sempre
 * sobre fundo escuro; cores fixas (não dependem do tema).
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

export interface MolduraCameraProps {
  /** Lado do quadrado (usado quando largura/altura não vêm). */
  tamanho?: number;
  largura?: number;
  altura?: number;
  corGlow?: string;
  children?: ReactNode;
}

const CANTO = 30;
const ESP = 3;

export function MolduraCamera({
  tamanho = 240,
  largura,
  altura,
  corGlow = '#5EEAD4',
  children,
}: MolduraCameraProps) {
  const w = largura ?? tamanho;
  const h = altura ?? tamanho;
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  // A linha é ancorada no topo (`top: 0`); varre de perto do topo até perto da
  // base, sempre DENTRO da moldura (a linha tem 2px de altura).
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [ESP, h - ESP - 2] });
  const canto = [styles.canto, { borderColor: corGlow }];

  return (
    <View style={{ width: w, height: h, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[canto, styles.tl]} />
      <View style={[canto, styles.tr]} />
      <View style={[canto, styles.bl]} />
      <View style={[canto, styles.br]} />

      <Animated.View
        style={[
          styles.linha,
          { backgroundColor: corGlow, shadowColor: corGlow, transform: [{ translateY }] },
        ]}
      />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  canto: {
    position: 'absolute',
    width: CANTO,
    height: CANTO,
    borderWidth: 0,
  },
  tl: { top: 0, left: 0, borderTopWidth: ESP, borderLeftWidth: ESP, borderTopLeftRadius: 14 },
  tr: { top: 0, right: 0, borderTopWidth: ESP, borderRightWidth: ESP, borderTopRightRadius: 14 },
  bl: {
    bottom: 0,
    left: 0,
    borderBottomWidth: ESP,
    borderLeftWidth: ESP,
    borderBottomLeftRadius: 14,
  },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: ESP,
    borderRightWidth: ESP,
    borderBottomRightRadius: 14,
  },
  linha: {
    position: 'absolute',
    top: 0,
    left: 10,
    right: 10,
    height: 2,
    borderRadius: 2,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
});
