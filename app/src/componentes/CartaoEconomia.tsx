/**
 * Redesign "2a" — hero do Início. Cartão em gradiente teal (150°) com um círculo
 * radial decorativo no canto e uma mini-sparkline menta no rodapé. Mostra a
 * economia (valor honesto vindo dos cupons) e, quando houver, um chip de delta.
 */

import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { espaco, raio, useTema } from '@/tema';

import { GradienteLinear } from './GradienteLinear';
import { IconeSetaBaixo, IconeSetaCima } from './icones';
import { Texto } from './Texto';

export interface CartaoEconomiaProps {
  rotulo: string;
  valor: string;
  legenda?: string;
  /** Pílula no canto superior direito (ex.: "Este mês"). */
  pilula?: string;
  /** Chip de variação vs. período anterior (omitido quando não há dado). */
  delta?: { texto: string; sentido: 'cima' | 'baixo' };
  style?: StyleProp<ViewStyle>;
}

// Pontos da sparkline decorativa (0..100 no eixo x; y menor = mais alto).
const SPARK = [26, 20, 24, 12, 18, 8, 14, 4];

export function CartaoEconomia({
  rotulo,
  valor,
  legenda,
  pilula,
  delta,
  style,
}: CartaoEconomiaProps) {
  const { c } = useTema();
  const [larguraSpark, setLarguraSpark] = useState(0);

  const pontosSpark = SPARK.map((y, i) => `${(i / (SPARK.length - 1)) * larguraSpark},${y}`).join(
    ' ',
  );

  return (
    <GradienteLinear
      cores={[c.heroDe, c.heroPara]}
      angulo={150}
      raio={raio.hero}
      style={[estilos.hero, style]}
    >
      {/* círculo radial decorativo */}
      <View style={estilos.circulo} pointerEvents="none" />
      {/* mini-sparkline no rodapé */}
      <View
        style={estilos.sparkWrap}
        pointerEvents="none"
        onLayout={(e) => setLarguraSpark(e.nativeEvent.layout.width)}
      >
        {larguraSpark > 0 ? (
          <Svg width={larguraSpark} height={34}>
            <Polyline
              points={pontosSpark}
              fill="none"
              stroke={c.menta}
              strokeOpacity={0.45}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </View>

      <View style={estilos.topo}>
        <Texto peso="bold" tamanho="sm" cor="menta" numberOfLines={1} style={estilos.rotulo}>
          {rotulo}
        </Texto>
        {pilula ? (
          <View style={estilos.pilula}>
            <Texto peso="bold" style={estilos.pilulaTxt}>
              {pilula}
            </Texto>
          </View>
        ) : null}
      </View>

      <Texto
        peso="extrabold"
        cor="branco"
        style={estilos.valor}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {valor}
      </Texto>

      {delta ? (
        <View style={estilos.chip}>
          {delta.sentido === 'cima' ? (
            <IconeSetaCima tamanho={14} cor={c.sobreTeal} />
          ) : (
            <IconeSetaBaixo tamanho={14} cor={c.sobreTeal} />
          )}
          <Texto peso="bold" tamanho="xs" cor="sobreTeal">
            {delta.texto}
          </Texto>
        </View>
      ) : legenda ? (
        <Texto tamanho="sm" cor="menta" style={estilos.legenda}>
          {legenda}
        </Texto>
      ) : null}
    </GradienteLinear>
  );
}

const estilos = StyleSheet.create({
  hero: { padding: espaco.xl, marginBottom: espaco.lg, minHeight: 168 },
  circulo: {
    position: 'absolute',
    top: -60,
    right: -50,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  sparkWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 34 },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rotulo: { flex: 1, marginRight: espaco.sm },
  pilula: {
    flexShrink: 0,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: raio.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pilulaTxt: { color: '#EAFBF7', fontSize: 11 },
  valor: { fontSize: 41, letterSpacing: -1.2, marginTop: espaco.sm },
  legenda: { marginTop: espaco.xs, opacity: 0.92 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: espaco.md,
    backgroundColor: '#5EEAD4',
    borderRadius: raio.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
