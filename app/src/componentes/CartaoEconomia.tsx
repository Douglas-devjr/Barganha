/**
 * Redesign "3a" — card do número grande do Início. No 2a era um hero em
 * gradiente; o 3a é um CARTÃO CHAPADO: eyebrow + número gigante (40/700/-2,
 * tabular) + legenda, e uma linha inferior de stats separada por divisória.
 *
 * O componente é só a forma — quem o usa decide o número. Hoje o Início passa o
 * desconto honesto vindo dos próprios cupons (nunca estimativa), então quando
 * não há desconto registrado o número é R$ 0,00 e a legenda explica — não
 * inventamos projeção.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { espaco, tabular, useTema } from '@/tema';

import { Eyebrow } from './layout3a';
import { Texto } from './Texto';

export interface CartaoEconomiaProps {
  /** Legenda MAIÚSCULA (ex.: "ECONOMIA · JULHO"). */
  rotulo: string;
  valor: string;
  legenda?: string;
  /** Ação textual no canto superior direito (ex.: "Ver resumo →"). */
  acao?: string;
  /** Linha inferior de estatísticas (ex.: "23 produtos"). Até 3. */
  stats?: string[];
  style?: StyleProp<ViewStyle>;
}

export function CartaoEconomia({
  rotulo,
  valor,
  legenda,
  acao,
  stats,
  style,
}: CartaoEconomiaProps) {
  const { c } = useTema();

  return (
    <View
      style={[estilos.cartao, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }, style]}
    >
      <View style={estilos.topo}>
        <Eyebrow style={{ flex: 1 }}>{rotulo}</Eyebrow>
        {acao ? (
          <Texto peso="semibold" style={estilos.acao}>
            {acao}
          </Texto>
        ) : null}
      </View>

      <Texto
        peso="bold"
        style={estilos.valor}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {valor}
      </Texto>

      {legenda ? (
        <Texto cor="suave" style={estilos.legenda}>
          {legenda}
        </Texto>
      ) : null}

      {stats && stats.length > 0 ? (
        <View style={[estilos.stats, { borderTopColor: c.cartaoBorda }]}>
          {stats.map((s) => (
            <Texto key={s} cor="suave" numerico style={estilos.stat}>
              {s}
            </Texto>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  cartao: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
  },
  topo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  acao: { fontSize: 11.5 },
  // "número gigante" do 3a
  valor: { fontSize: 40, letterSpacing: -2, marginTop: 6, ...tabular },
  legenda: { fontSize: 12.5, marginTop: 2 },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    marginTop: espaco.md,
    paddingTop: 10,
  },
  stat: { fontSize: 11 },
});
