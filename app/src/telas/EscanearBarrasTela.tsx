/**
 * C7.1 + Redesign "3a" — Scanner de código de barras na gôndola (caminho
 * PRINCIPAL de entrada). Lê o EAN e o devolve à aba Verificar, que resolve o
 * veredito. Não grava nada: diferente do scan de QR do cupom (C6.1), aqui só
 * identificamos o produto a consultar. Tela sempre escura (câmera).
 */

import { CameraView } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Botao, IconeBarras, IconeFechar, MolduraCamera, Texto } from '@/componentes';
import { useCameraPronta } from '@/nucleo/camera';
import { depositarEanEscaneado } from '@/nucleo/scan-pendente';
import { TemaFixo, comAlfa, escuro as paletaEscura, espaco, raio } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'EscanearBarras'>;

// O overlay da câmera é escuro nos dois temas — daí a paleta escura fixa.
const FUNDO = paletaEscura.fundo;
const ACENTO = paletaEscura.tinta;

// Formatos de código de barras de produto (não QR).
const FORMATOS_EAN = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

export function EscanearBarrasTela({ navigation, route }: Props) {
  // Pede a permissão sozinho e desmonta a câmera fora de foco/primeiro plano
  // (senão o preview volta PRETO no Android).
  const { estado, erro, aoFalhar, tentarDeNovo, pedirPermissao } = useCameraPronta();
  const lido = useRef(false);
  const { resolveItemListaId, nomeItemPendente } = route.params ?? {};

  function aoLer(ean: string) {
    if (lido.current) return;
    lido.current = true;
    depositarEanEscaneado(ean, resolveItemListaId ? { resolveItemListaId } : undefined);
    navigation.navigate('Abas', { screen: 'Verificar' });
  }

  return (
    <TemaFixo modo="escuro">
      <SafeAreaView style={estilos.raiz} edges={['top', 'bottom']}>
        {estado === 'pronta' ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            // Autofoco: iOS-only nesta versão, mas inofensivo no Android.
            autofocus="on"
            barcodeScannerSettings={{ barcodeTypes: [...FORMATOS_EAN] }}
            onBarcodeScanned={({ data }) => aoLer(data)}
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
          <Texto cor="tinta" peso="bold" tamanho="lg" numberOfLines={1} style={estilos.titulo}>
            {nomeItemPendente ? `Escaneando: ${nomeItemPendente}` : 'Código de barras'}
          </Texto>
          <View style={estilos.fechar} />
        </View>

        <View style={estilos.centro}>
          <MolduraCamera largura={270} altura={190} corGlow={ACENTO}>
            {estado !== 'pronta' ? <IconeBarras tamanho={56} cor={ACENTO} /> : null}
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
                A permissão da câmera está negada. Libere em Ajustes para ler o código de barras.
              </Texto>
              <Botao titulo="Abrir configurações" onPress={() => void Linking.openSettings()} />
            </View>
          ) : estado === 'sem_permissao' ? (
            <View style={estilos.permissao}>
              <Texto cor="tinta" centralizado style={estilos.dica}>
                Precisamos da câmera para ler o código de barras.
              </Texto>
              <Botao titulo="Permitir câmera" onPress={pedirPermissao} />
            </View>
          ) : estado === 'pronta' ? (
            <Texto cor="tinta" centralizado style={estilos.dica}>
              Aponte para o código de barras do produto.
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
  titulo: { flex: 1, textAlign: 'center', marginHorizontal: espaco.sm },
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
