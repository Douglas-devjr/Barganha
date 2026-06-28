/**
 * C5.1 — Scanner (esqueleto, modal). A câmera + leitura de QR e a gravação do
 * QR cru local são C6.1; aqui ficam a moldura imersiva e o alvo de leitura.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconeScan, IconeVoltar, Texto } from '@/componentes';
import { cores, espaco, raio } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'Scanner'>;

export function ScannerTela({ navigation }: Props) {
  return (
    <SafeAreaView style={estilos.raiz} edges={['top', 'bottom']}>
      <View style={estilos.topo}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          style={estilos.fechar}
        >
          <IconeVoltar tamanho={22} cor={cores.branco} />
        </Pressable>
        <Texto cor="branco" peso="bold" tamanho="lg">
          Escanear cupom
        </Texto>
        <View style={estilos.fechar} />
      </View>

      <View style={estilos.centro}>
        <View style={estilos.alvo}>
          <IconeScan tamanho={56} cor={cores.marcaClara} />
        </View>
        <Texto cor="placeholder" centralizado style={{ marginTop: espaco.xl, maxWidth: 280 }}>
          Aponte para o QR Code da nota fiscal. A leitura e o histórico chegam na Camada 6.
        </Texto>
      </View>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: cores.textoForte },
  topo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
  fechar: {
    width: 40,
    height: 40,
    borderRadius: raio.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espaco.xl },
  alvo: {
    width: 240,
    height: 240,
    borderRadius: raio.xl,
    borderWidth: 2,
    borderColor: 'rgba(94,234,212,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
