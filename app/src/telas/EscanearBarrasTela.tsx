/**
 * C7.1 — Scanner de código de barras na gôndola (caminho PRINCIPAL de entrada).
 * Lê o EAN do produto e o devolve à aba Verificar, que resolve o veredito. Não
 * grava nada: diferente do scan de QR do cupom (C6.1), aqui só identificamos o
 * produto a consultar.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Botao, IconeBarras, IconeVoltar, Texto } from '@/componentes';
import { cores, espaco, raio } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'EscanearBarras'>;

// Formatos de código de barras de produto (não QR).
const FORMATOS_EAN = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

export function EscanearBarrasTela({ navigation }: Props) {
  const [permissao, pedirPermissao] = useCameraPermissions();
  const lido = useRef(false);

  function aoLer(ean: string) {
    if (lido.current) return;
    lido.current = true;
    // Volta à aba Verificar entregando o EAN (params aninhados do navigator).
    navigation.navigate('Abas', { screen: 'Verificar', params: { ean } });
  }

  return (
    <SafeAreaView style={estilos.raiz} edges={['top', 'bottom']}>
      {permissao?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: [...FORMATOS_EAN] }}
          onBarcodeScanned={({ data }) => aoLer(data)}
        />
      ) : null}
      <View style={estilos.veu} />

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
          Código de barras
        </Texto>
        <View style={estilos.fechar} />
      </View>

      <View style={estilos.centro}>
        <View style={estilos.alvo}>
          {!permissao?.granted ? <IconeBarras tamanho={56} cor={cores.marcaClara} /> : null}
        </View>

        {permissao?.granted ? (
          <Texto cor="branco" centralizado style={estilos.dica}>
            Aponte para o código de barras do produto.
          </Texto>
        ) : (
          <View style={estilos.permissao}>
            <Texto cor="branco" centralizado style={estilos.dica}>
              Precisamos da câmera para ler o código de barras.
            </Texto>
            {permissao && !permissao.canAskAgain ? (
              <Botao titulo="Abrir configurações" onPress={() => void Linking.openSettings()} />
            ) : (
              <Botao titulo="Permitir câmera" onPress={() => void pedirPermissao()} />
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: cores.textoForte },
  veu: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,18,32,0.45)' },
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
    width: 260,
    height: 180,
    borderRadius: raio.xl,
    borderWidth: 2,
    borderColor: 'rgba(94,234,212,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dica: { marginTop: espaco.xl, maxWidth: 300 },
  permissao: {
    marginTop: espaco.lg,
    alignSelf: 'stretch',
    gap: espaco.md,
    paddingHorizontal: espaco.xl,
  },
});
