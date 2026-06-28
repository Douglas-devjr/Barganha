/**
 * C6.1 — Scanner de QR da NFC-e. Lê o QR com `expo-camera` e grava o QR CRU
 * localmente ANTES de qualquer rede (offline-first, decisão travada): a captura
 * funciona sem sinal; o upload e o parsing vêm depois (C6.2). Após gravar, segue
 * para a Nota fiscal, que acompanha o processamento.
 *
 * Não fazemos parsing da nota no app — só capturamos o conteúdo do QR (decisão
 * travada). A extração da chave e o parser rodam no backend.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Botao, IconeScan, IconeVoltar, Texto } from '@/componentes';
import { cupons } from '@/dados';
import { sincronizar } from '@/nucleo/sincronizador';
import { cores, espaco, raio } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'Scanner'>;

export function ScannerTela({ navigation }: Props) {
  const [permissao, pedirPermissao] = useCameraPermissions();
  // Trava de captura: ignora leituras repetidas do mesmo QR enquanto navegamos.
  const lido = useRef(false);

  async function aoLer(qrPayload: string) {
    if (lido.current) return;
    lido.current = true;
    try {
      const cupom = await cupons.registrarCaptura({ qrPayload });
      void sincronizar(); // best-effort: tenta subir já se houver sinal.
      navigation.replace('NotaFiscal', { cupomLocalId: cupom.id });
    } catch {
      lido.current = false;
      Alert.alert('Não foi possível salvar', 'Tente escanear o cupom novamente.');
    }
  }

  return (
    <SafeAreaView style={estilos.raiz} edges={['top', 'bottom']}>
      {permissao?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => void aoLer(data)}
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
          Escanear cupom
        </Texto>
        <View style={estilos.fechar} />
      </View>

      <View style={estilos.centro}>
        <View style={estilos.alvo}>
          {!permissao?.granted ? <IconeScan tamanho={56} cor={cores.marcaClara} /> : null}
        </View>

        {permissao?.granted ? (
          <Texto cor="branco" centralizado style={estilos.dica}>
            Aponte para o QR Code da nota fiscal.
          </Texto>
        ) : (
          <View style={estilos.permissao}>
            <Texto cor="branco" centralizado style={estilos.dica}>
              Precisamos da câmera para ler o QR Code do cupom.
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
  // Escurece a câmera para a moldura e os textos ficarem legíveis.
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
    width: 240,
    height: 240,
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
