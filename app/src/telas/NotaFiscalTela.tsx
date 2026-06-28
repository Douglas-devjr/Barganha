/**
 * C5.1 — Nota fiscal (esqueleto). A tela com itens parseados + "Salvar no
 * histórico" é C6.3. Recebe o `cupomLocalId` capturado offline.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { CabecalhoVoltar, Cartao, Tela, Texto } from '@/componentes';
import { espaco } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'NotaFiscal'>;

export function NotaFiscalTela({ navigation, route }: Props) {
  const { cupomLocalId } = route.params;
  return (
    <Tela>
      <CabecalhoVoltar
        titulo="Nota fiscal"
        subtitulo="Itens parseados (Camada 6)"
        aoVoltar={() => navigation.goBack()}
      />
      <Cartao>
        <Texto cor="textoMudo">Os itens da nota aparecem aqui após o backend processar o QR.</Texto>
        <Texto cor="placeholder" tamanho="sm" style={{ marginTop: espaco.sm }}>
          Cupom local: {cupomLocalId}
        </Texto>
      </Cartao>
    </Tela>
  );
}
