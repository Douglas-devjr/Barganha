/**
 * Redesign "2a" — BarraPreco ⭐ (a peça-chave do veredito). Posiciona o preço
 * visto entre um mínimo e um máximo de referência da região, sobre um trilho
 * verde→teal→vermelho. O balão mostra o preço; abaixo, as três âncoras
 * (Menor / Típico / Maior).
 *
 * Componente puramente visual: recebe os números já resolvidos e um formatador.
 * A classificação (barato/na média/caro) vem de @barganha/shared e entra só na
 * cor da borda do thumb.
 */

import type { Veredito } from '@barganha/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { espaco, raio, useTema, veredito as mapaVeredito } from '@/tema';

import { GradienteLinear } from './GradienteLinear';
import { Texto } from './Texto';

export interface BarraPrecoProps {
  preco: number;
  /** Referência inferior (ex.: p25 da faixa). */
  min: number;
  /** Referência superior (ex.: p75 da faixa). */
  max: number;
  /** Típico (mediana) — só rótulo central. */
  tipico: number;
  veredito: Veredito;
  formatar: (v: number) => string;
}

const THUMB = 19;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function BarraPreco({ preco, min, max, tipico, veredito, formatar }: BarraPrecoProps) {
  const { c, escuro } = useTema();
  const corV = mapaVeredito(c)[veredito].fg;
  const [larguraTrilho, setLarguraTrilho] = useState(0);
  const [larguraBalao, setLarguraBalao] = useState(0);

  const span = max - min || 1;
  const pct = clamp((preco - min) / span, 0.04, 0.96);

  const centro = larguraTrilho * pct;
  const thumbLeft = centro - THUMB / 2;
  const balaoLeft = clamp(centro - larguraBalao / 2, 0, Math.max(0, larguraTrilho - larguraBalao));
  const corBalao = escuro ? c.teal : c.tinta;

  return (
    <View>
      {/* balão do preço */}
      <View style={estilos.faixaBalao}>
        {larguraTrilho > 0 ? (
          <View
            style={[estilos.balao, { left: balaoLeft }]}
            onLayout={(e) => setLarguraBalao(e.nativeEvent.layout.width)}
          >
            <View style={[estilos.balaoPilula, { backgroundColor: corBalao }]}>
              <Texto peso="extrabold" tamanho="sm" cor="branco">
                {formatar(preco)}
              </Texto>
            </View>
            <View style={[estilos.caret, { borderTopColor: corBalao }]} />
          </View>
        ) : null}
      </View>

      {/* trilho */}
      <View
        style={[estilos.trilhoWrap, escuro && { shadowColor: c.teal }]}
        onLayout={(e) => setLarguraTrilho(e.nativeEvent.layout.width)}
      >
        <GradienteLinear
          cores={['#22C55E', '#0F766E', '#EF4444']}
          locais={[0, 0.48, 1]}
          angulo={90}
          raio={raio.pill}
          style={estilos.trilho}
        />
        {larguraTrilho > 0 ? (
          <View style={[estilos.thumb, { left: thumbLeft, borderColor: corV }]} />
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
  faixaBalao: { height: 34, justifyContent: 'flex-end' },
  balao: { position: 'absolute', alignItems: 'center' },
  balaoPilula: {
    borderRadius: raio.sm,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  caret: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
  trilhoWrap: {
    height: THUMB,
    justifyContent: 'center',
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  trilho: { height: 10, width: '100%' },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 4,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  legendas: { flexDirection: 'row', marginTop: espaco.sm },
  legenda: { flex: 1, fontSize: 10.5 },
  legendaCentro: { textAlign: 'center' },
  legendaFim: { textAlign: 'right' },
});
