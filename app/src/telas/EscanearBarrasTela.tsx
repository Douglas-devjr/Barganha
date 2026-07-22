/**
 * C7.1 + Redesign "3a" — Scanner de código de barras na gôndola (caminho
 * PRINCIPAL de entrada). Lê o EAN e o devolve à aba Verificar, que resolve o
 * veredito. Não grava nada: diferente do scan de QR do cupom (C6.1), aqui só
 * identificamos o produto a consultar. Tela sempre escura (câmera).
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Botao, IconeBarras, IconeFechar, MolduraCamera, Texto } from '@/componentes';
import { useCameraAtiva } from '@/nucleo/camera';
import { depositarEanEscaneado } from '@/nucleo/scan-pendente';
import { TemaFixo, comAlfa, escuro as paletaEscura, espaco, raio } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'EscanearBarras'>;

// O overlay da câmera é escuro nos dois temas — daí a paleta escura fixa.
const FUNDO = paletaEscura.fundo;
const ACENTO = paletaEscura.tinta;

// Formatos de código de barras de produto (não QR).
const FORMATOS_EAN = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

export function EscanearBarrasTela({ navigation }: Props) {
  const [permissao, pedirPermissao] = useCameraPermissions();
  // Desmonta a câmera fora de foco/primeiro plano — senão o preview volta PRETO.
  const cameraAtiva = useCameraAtiva();
  const [erroCamera, setErroCamera] = useState<string | null>(null);
  const lido = useRef(false);

  function aoLer(ean: string) {
    if (lido.current) return;
    lido.current = true;
    depositarEanEscaneado(ean);
    navigation.navigate('Abas', { screen: 'Verificar' });
  }

  return (
    <TemaFixo modo="escuro">
      <SafeAreaView style={estilos.raiz} edges={['top', 'bottom']}>
        {permissao?.granted && cameraAtiva && erroCamera == null ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            // Autofoco ligado: o EAN-13 (barras finas 1D) exige foco nítido.
            autofocus="on"
            barcodeScannerSettings={{ barcodeTypes: [...FORMATOS_EAN] }}
            onBarcodeScanned={({ data }) => aoLer(data)}
            onMountError={({ message }) => setErroCamera(message || 'erro desconhecido')}
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
            <IconeFechar tamanho={22} cor={ACENTO} />
          </Pressable>
          <Texto cor="tinta" peso="bold" tamanho="lg">
            Código de barras
          </Texto>
          <View style={estilos.fechar} />
        </View>

        <View style={estilos.centro}>
          <MolduraCamera largura={270} altura={190} corGlow={ACENTO}>
            {!permissao?.granted ? <IconeBarras tamanho={56} cor={ACENTO} /> : null}
          </MolduraCamera>

          {erroCamera != null ? (
            <View style={estilos.permissao}>
              <Texto cor="tinta" centralizado style={estilos.dica}>
                A câmera não abriu. Feche outros apps que estejam usando a câmera e tente de novo.
              </Texto>
              <Botao titulo="Tentar de novo" onPress={() => setErroCamera(null)} />
            </View>
          ) : permissao?.granted ? (
            <Texto cor="tinta" centralizado style={estilos.dica}>
              Aponte para o código de barras do produto.
            </Texto>
          ) : (
            <View style={estilos.permissao}>
              <Texto cor="tinta" centralizado style={estilos.dica}>
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
    </TemaFixo>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: FUNDO },
  veu: { ...StyleSheet.absoluteFillObject, backgroundColor: comAlfa(FUNDO, 0.5) },
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
    backgroundColor: comAlfa(ACENTO, 0.12),
  },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espaco.xl },
  dica: { marginTop: espaco.xl, maxWidth: 300 },
  permissao: {
    marginTop: espaco.lg,
    alignSelf: 'stretch',
    gap: espaco.md,
    paddingHorizontal: espaco.xl,
  },
});
