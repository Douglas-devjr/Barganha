/**
 * Redesign "3a" — segmentado de caixas iguais (o "3% / 5% / 10%" da
 * sensibilidade do alerta e o "1 / 3 / 5 km" do raio das comparações).
 *
 * Medidas do protótipo: cada opção `flex:1`, altura 38, raio 10, borda 1. Ativa
 * = fundo `chip` com texto `chipink`; inativa = fundo `card` com borda `line`.
 * Diferente do segmentado-pílula do Dashboard, que agrupa muitas opções e
 * quebra linha — aqui são sempre poucas e dividem a largura.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { espaco, raio, useTema } from '@/tema';

import { Texto } from './Texto';

export interface OpcaoSegmentada<T> {
  valor: T;
  rotulo: string;
}

export interface SegmentadoProps<T> {
  opcoes: readonly OpcaoSegmentada<T>[];
  valor: T;
  aoMudar: (valor: T) => void;
  /** Rótulo acessível do grupo (ex.: "Sensibilidade do alerta"). */
  rotuloGrupo?: string;
}

export function Segmentado<T extends string | number>({
  opcoes,
  valor,
  aoMudar,
  rotuloGrupo,
}: SegmentadoProps<T>) {
  const { c } = useTema();

  return (
    <View style={estilos.linha} accessibilityRole="radiogroup" accessibilityLabel={rotuloGrupo}>
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <Pressable
            key={String(o.valor)}
            onPress={() => aoMudar(o.valor)}
            accessibilityRole="radio"
            accessibilityState={{ selected: ativo }}
            style={[
              estilos.opcao,
              {
                backgroundColor: ativo ? c.teal : c.cartao,
                borderColor: ativo ? c.teal : c.borda,
              },
            ]}
          >
            <Texto peso="semibold" cor={ativo ? 'sobreTeal' : 'suave'} style={estilos.rotulo}>
              {o.rotulo}
            </Texto>
          </Pressable>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  linha: { flexDirection: 'row', gap: espaco.sm },
  opcao: {
    flex: 1,
    // 44 (e não os 38 do protótipo) para respeitar o alvo mínimo de toque.
    minHeight: 44,
    borderRadius: raio.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotulo: { fontSize: 12.5 },
});
