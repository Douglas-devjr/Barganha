/**
 * C7.5 — Mini-gráfico de evolução (sparkline) em react-native-svg, no estilo do
 * protótipo: área teal suave + linha + ponto no último valor. Recebe os preços
 * em ordem cronológica; escala sozinho ao mín/máx da série.
 */

import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { cores, espaco } from '@/tema';

import { Texto } from './Texto';

export interface GraficoLinhaProps {
  /** Preços em ordem cronológica (mais antigo → mais recente). */
  valores: number[];
  /** Rótulos das pontas (ex.: meses). */
  inicio?: string;
  fim?: string;
  altura?: number;
}

const L = 300; // largura do viewBox
const A = 120; // altura útil do viewBox
const PAD = 10;

export function GraficoLinha({ valores, inicio, fim, altura = 130 }: GraficoLinhaProps) {
  if (valores.length < 2) {
    return (
      <View style={[estilos.vazio, { height: altura }]}>
        <Texto cor="placeholder" tamanho="sm" centralizado>
          Poucas compras para traçar a evolução ainda.
        </Texto>
      </View>
    );
  }

  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const span = max - min || 1; // evita divisão por zero numa série constante

  const pontos = valores.map((v, i) => {
    const x = PAD + (i / (valores.length - 1)) * (L - 2 * PAD);
    const y = PAD + (1 - (v - min) / span) * (A - 2 * PAD);
    return { x, y };
  });

  const linha = pontos.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const ultimo = pontos.at(-1);
  if (!ultimo) return null; // inalcançável (>= 2 pontos); satisfaz o tipo
  // Área = linha + descida até a base + volta ao início.
  const area = `${linha} ${ultimo.x.toFixed(1)},${A} ${PAD},${A}`;

  return (
    <View>
      <Svg viewBox={`0 0 ${L} ${A + 10}`} width="100%" height={altura}>
        <Polyline points={area} fill={cores.marca} fillOpacity={0.07} stroke="none" />
        <Polyline
          points={linha}
          fill="none"
          stroke={cores.marca}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={ultimo.x} cy={ultimo.y} r={10} fill={cores.marca} fillOpacity={0.18} />
        <Circle cx={ultimo.x} cy={ultimo.y} r={5.5} fill={cores.marca} />
      </Svg>
      {inicio || fim ? (
        <View style={estilos.eixo}>
          <Texto cor="placeholder" tamanho="xs" peso="semibold">
            {inicio ?? ''}
          </Texto>
          <Texto cor="placeholder" tamanho="xs" peso="semibold">
            {fim ?? ''}
          </Texto>
        </View>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  vazio: { alignItems: 'center', justifyContent: 'center' },
  eixo: { flexDirection: 'row', justifyContent: 'space-between', marginTop: espaco.xs },
});
