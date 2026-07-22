/**
 * Redesign "3a" — BarraPreco ⭐ (a peça-chave do veredito). Posiciona o preço
 * visto entre um mínimo e um máximo de referência da região.
 *
 * O 3a trocou o trilho colorido (verde→teal→vermelho do 2a) por uma RÉGUA
 * NEUTRA: trilho `borda` de 3px, um tick do "típico" e um marcador de 14px na
 * tinta com anel `cartao`. A cor saiu da régua porque no 3a o semáforo vive só
 * na pílula do veredito — a régua informa posição, não julgamento.
 *
 * Componente puramente visual: recebe os números já resolvidos e um formatador.
 * O preço em destaque é responsabilidade de quem chama (no handoff ele aparece
 * grande, acima da régua).
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { espaco, raio, tabular, useTema } from '@/tema';

import { useDuracao } from './movimento';
import { Texto } from './Texto';

export interface BarraPrecoProps {
  preco: number;
  /** Referência inferior (ex.: p25 da faixa). */
  min: number;
  /** Referência superior (ex.: p75 da faixa). */
  max: number;
  /** Típico (mediana) — vira o tick da régua e o rótulo central. */
  tipico: number;
  formatar: (v: number) => string;
}

const MARCADOR = 14;
const ANEL = 3;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function BarraPreco({ preco, min, max, tipico, formatar }: BarraPrecoProps) {
  const { c } = useTema();
  const [largura, setLargura] = useState(0);

  const span = max - min || 1;
  // O marcador é preso à régua; o tick do típico segue o dado real (o protótipo
  // fixava 46% só porque o exemplo caía ali).
  const pct = clamp((preco - min) / span, 0, 1);
  const pctTipico = clamp((tipico - min) / span, 0, 1);

  // Handoff: o marcador desliza até a nova posição em 0.5s (0 com "reduzir
  // movimento"). Anima `left`, que não é suportado pelo driver nativo.
  const duracao = useDuracao(500);
  const anim = useRef(new Animated.Value(pct)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: duracao, useNativeDriver: false }).start();
  }, [anim, pct, duracao]);

  const esquerda = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-MARCADOR / 2 - ANEL, largura - MARCADOR / 2 - ANEL],
  });

  return (
    <View>
      <View style={estilos.trilhoWrap} onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
        <View style={[estilos.trilho, { backgroundColor: c.borda }]} />

        {largura > 0 ? (
          <>
            {/* tick do típico */}
            <View
              style={[estilos.tick, { left: largura * pctTipico - 1, backgroundColor: c.fraco }]}
            />
            {/* marcador do preço visto */}
            <Animated.View
              style={[
                estilos.marcador,
                { left: esquerda, backgroundColor: c.tinta, borderColor: c.cartao },
              ]}
            />
          </>
        ) : null}
      </View>

      {/* âncoras */}
      <View style={estilos.legendas}>
        <Texto peso="semibold" style={estilos.legenda} cor="fraco">
          Menor {formatar(min)}
        </Texto>
        <Texto peso="semibold" style={[estilos.legenda, estilos.legendaCentro]} cor="fraco">
          Típico {formatar(tipico)}
        </Texto>
        <Texto peso="semibold" style={[estilos.legenda, estilos.legendaFim]} cor="fraco">
          Maior {formatar(max)}
        </Texto>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  trilhoWrap: { height: MARCADOR + ANEL * 2, justifyContent: 'center' },
  trilho: { height: 3, width: '100%', borderRadius: raio.pill },
  tick: { position: 'absolute', width: 2, height: 9, borderRadius: 1 },
  marcador: {
    position: 'absolute',
    width: MARCADOR,
    height: MARCADOR,
    borderRadius: raio.pill,
    borderWidth: ANEL,
  },
  legendas: { flexDirection: 'row', marginTop: espaco.sm },
  legenda: { flex: 1, fontSize: 10.5, ...tabular },
  legendaCentro: { textAlign: 'center' },
  legendaFim: { textAlign: 'right' },
});
