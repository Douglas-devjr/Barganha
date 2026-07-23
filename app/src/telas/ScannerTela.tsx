/**
 * C6.1 + Redesign "3a" — Scanner de QR da NFC-e. Lê o QR com `expo-camera` e
 * grava o QR CRU localmente ANTES de qualquer rede (offline-first, decisão
 * travada): a captura funciona sem sinal; o upload e o parsing vêm depois (C6.2).
 * Após gravar, segue para a Nota fiscal, que acompanha o processamento.
 *
 * Tela sempre ESCURA (câmera, nos dois temas — daí o `TemaFixo`): moldura com
 * cantos claros e linha de leitura, botão fechar (X).
 * Não fazemos parsing no app — só capturamos o conteúdo do QR (decisão travada).
 */

import { CameraView } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Botao, IconeFechar, IconeScan, MolduraCamera, Texto } from '@/componentes';
import { cupons } from '@/dados';
import { useCameraPronta } from '@/nucleo/camera';
import { sincronizar } from '@/nucleo/sincronizador';
import { TemaFixo, comAlfa, escuro as paletaEscura, espaco, raio } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'Scanner'>;

// O overlay da câmera é escuro nos dois temas — daí a paleta escura fixa.
const FUNDO = paletaEscura.fundo;
const ACENTO = paletaEscura.tinta;

export function ScannerTela({ navigation }: Props) {
  // Pede a permissão sozinho e desmonta a câmera fora de foco/primeiro plano
  // (senão o preview volta PRETO no Android).
  const { estado, erro, aoFalhar, tentarDeNovo, pedirPermissao } = useCameraPronta();
  const lido = useRef(false);

  async function aoLer(qrPayload: string) {
    if (lido.current) return;
    lido.current = true;
    try {
      const cupom = await cupons.registrarCaptura({ qrPayload });
      void sincronizar();
      navigation.replace('NotaFiscal', { cupomLocalId: cupom.id });
    } catch {
      lido.current = false;
      Alert.alert('Não foi possível salvar', 'Tente escanear o cupom novamente.');
    }
  }

  return (
    <TemaFixo modo="escuro">
      <SafeAreaView style={estilos.raiz} edges={['top', 'bottom']}>
        {estado === 'pronta' ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => void aoLer(data)}
            onMountError={({ message }) => aoFalhar(message)}
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
            Escanear cupom
          </Texto>
          <View style={estilos.fechar} />
        </View>

        <View style={estilos.centro}>
          <MolduraCamera tamanho={250} corGlow={ACENTO}>
            {estado !== 'pronta' ? <IconeScan tamanho={56} cor={ACENTO} /> : null}
          </MolduraCamera>

          {estado === 'erro' ? (
            <View style={estilos.permissao}>
              <Texto cor="tinta" centralizado style={estilos.dica}>
                A câmera não abriu. Feche outros apps que a estejam usando e tente de novo.
              </Texto>
              {/* mostra a causa real em vez de escondê-la atrás do texto genérico */}
              <Texto cor="suave" tamanho="xs" centralizado>
                {erro}
              </Texto>
              <Botao titulo="Tentar de novo" onPress={tentarDeNovo} />
            </View>
          ) : estado === 'bloqueada' ? (
            <View style={estilos.permissao}>
              <Texto cor="tinta" centralizado style={estilos.dica}>
                A permissão da câmera está negada. Libere em Ajustes para escanear o cupom.
              </Texto>
              <Botao titulo="Abrir configurações" onPress={() => void Linking.openSettings()} />
            </View>
          ) : estado === 'sem_permissao' ? (
            <View style={estilos.permissao}>
              <Texto cor="tinta" centralizado style={estilos.dica}>
                Precisamos da câmera para ler o QR Code do cupom.
              </Texto>
              <Botao titulo="Permitir câmera" onPress={pedirPermissao} />
            </View>
          ) : estado === 'pronta' ? (
            <Texto cor="tinta" centralizado style={estilos.dica}>
              Aponte para o QR Code da nota fiscal.
            </Texto>
          ) : null}
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
