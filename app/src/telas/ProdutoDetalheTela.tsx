/**
 * C5.1 — Detalhe do produto (esqueleto). O gráfico de evolução de 6 meses e o
 * histórico de compras são C7.5. Recebe o produto canônico a exibir.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';

import { CabecalhoVoltar, Cartao, Tela, Texto } from '@/componentes';
import { espaco } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'ProdutoDetalhe'>;

export function ProdutoDetalheTela({ navigation, route }: Props) {
  const { nome } = route.params;
  return (
    <Tela>
      <CabecalhoVoltar
        titulo={nome ?? 'Produto'}
        subtitulo="Evolução de preço (Camada 7)"
        aoVoltar={() => navigation.goBack()}
      />
      <Cartao>
        <View style={{ alignItems: 'center', paddingVertical: espaco.xl }}>
          <Texto cor="textoMudo" centralizado>
            O gráfico de 6 meses e as compras aparecem aqui quando houver histórico em cache.
          </Texto>
        </View>
      </Cartao>
    </Tela>
  );
}
