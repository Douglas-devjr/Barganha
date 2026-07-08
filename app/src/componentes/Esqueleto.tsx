/**
 * Redesign "2a" — esqueleto (shimmer) para carregamento. Uma barra na cor `linha`
 * com um brilho (`borda`) deslizando em loop. Use várias empilhadas enquanto a
 * nota processa.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, type DimensionValue } from 'react-native';

import { raio, useTema } from '@/tema';

import { GradienteLinear } from './GradienteLinear';

export interface EsqueletoProps {
  largura?: DimensionValue;
  altura?: number;
  raioBarra?: number;
  style?: View['props']['style'];
}

export function Esqueleto({ largura = '100%', altura = 14, raioBarra = raio.sm, style }: EsqueletoProps) {
  const { c } = useTema();
  const [l, setL] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (l === 0) return;
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, l]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-l, l],
  });

  return (
    <View
      onLayout={(e) => setL(e.nativeEvent.layout.width)}
      style={[
        { width: largura, height: altura, borderRadius: raioBarra, backgroundColor: c.linha },
        estilos.base,
        style,
      ]}
    >
      {l > 0 ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
          <GradienteLinear
            cores={['transparent', c.borda, 'transparent']}
            angulo={90}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  base: { overflow: 'hidden' },
});
