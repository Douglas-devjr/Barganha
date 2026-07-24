/**
 * Handoff 3a (`chave`) — saída para quando o QR Code não lê: o usuário digita os
 * 44 dígitos impressos no rodapé da NFC-e.
 *
 * Formatação em blocos de 4 e contador ao vivo (N/44); "Validar chave" só
 * habilita com os 44 completos. A validação AQUI é só de forma (44 dígitos) —
 * quem valida de verdade (dígito verificador, UF, layout) é o backend, como
 * manda a decisão travada nº2. O app nunca parseia SEFAZ.
 *
 * A captura entra pelo MESMO caminho do scanner (`registrarCaptura` + fila): o
 * conteúdo cru é gravado antes de qualquer rede, então digitar a chave funciona
 * offline igual a escanear.
 *
 * LIMITE CONHECIDO: o QR traz uma URL de consulta da SEFAZ; a chave sozinha não.
 * O cupom fica guardado e enfileirado (é exatamente o que docs/03 prevê para
 * reprocessamento retroativo), mas a leitura automática só acontece nos estados
 * em que o backend souber montar a consulta a partir da chave. A tela não
 * promete leitura imediata por isso.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import {
  Botao,
  CabecalhoVoltar,
  Cartao,
  Eyebrow,
  IconeInfo,
  Tela,
  Texto,
  useToast,
} from '@/componentes';
import { cupons } from '@/dados';
import type { RootStackParamList } from '@/navegacao/tipos';
import { sincronizar } from '@/nucleo/sincronizador';
import { espaco, raio, tabular, useTema } from '@/tema';

type Props = NativeStackScreenProps<RootStackParamList, 'DigitarChave'>;

/** Toda chave de acesso da NFC-e tem exatamente 44 dígitos. */
const DIGITOS = 44;

/** Só os dígitos, cortado no tamanho da chave (colar o cupom inteiro não quebra). */
function apenasDigitos(texto: string): string {
  return texto.replace(/\D/g, '').slice(0, DIGITOS);
}

/** "3326 0612 3456 …" — blocos de 4, como o cupom imprime. */
function emBlocos(digitos: string): string {
  return digitos.replace(/(.{4})/g, '$1 ').trim();
}

export function DigitarChaveTela({ navigation }: Props) {
  const { c } = useTema();
  const toast = useToast();
  const [digitos, setDigitos] = useState('');
  const [salvando, setSalvando] = useState(false);

  const completa = digitos.length === DIGITOS;

  async function validar() {
    if (!completa) {
      toast(`Faltam ${DIGITOS - digitos.length} dígitos para completar a chave`);
      return;
    }
    setSalvando(true);
    try {
      // Mesmo contrato do scanner: o conteúdo cru vira `qrPayload`. Aqui o cru
      // é a própria chave — o backend aceita payload de 44 dígitos.
      const cupom = await cupons.registrarCaptura({ qrPayload: digitos, chaveAcesso: digitos });
      void sincronizar();
      navigation.replace('NotaFiscal', { cupomLocalId: cupom.id, recemCapturado: true });
    } catch {
      setSalvando(false);
      toast('Não foi possível salvar a chave. Tente de novo.');
    }
  }

  return (
    <Tela>
      <CabecalhoVoltar
        titulo="Digitar chave"
        subtitulo="Sem leitura do QR Code"
        aoVoltar={() => navigation.goBack()}
      />

      <Texto peso="bold" style={estilos.titulo}>
        Digite a chave de acesso
      </Texto>
      <Texto cor="suave" style={estilos.apoio}>
        São os {DIGITOS} números impressos no rodapé do cupom, logo abaixo do QR Code.
      </Texto>

      <View style={estilos.rotuloLinha}>
        <Eyebrow>Chave de acesso · NFC-e</Eyebrow>
        <Texto
          peso="semibold"
          numerico
          style={[estilos.contador, { color: completa ? c.tinta : c.fraco }]}
        >
          {digitos.length}/{DIGITOS}
        </Texto>
      </View>

      <TextInput
        value={emBlocos(digitos)}
        onChangeText={(t) => setDigitos(apenasDigitos(t))}
        placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000"
        placeholderTextColor={c.fraco}
        keyboardType="number-pad"
        multiline
        editable={!salvando}
        accessibilityLabel="Chave de acesso da NFC-e"
        style={[
          estilos.campo,
          {
            backgroundColor: c.superficie,
            color: c.tinta,
            borderColor: completa ? c.tinta : c.borda,
          },
        ]}
      />

      <Cartao style={estilos.dica}>
        <View style={estilos.dicaLinha}>
          <IconeInfo tamanho={16} cor={c.suave} larguraTraco={2} />
          <Texto cor="suave" tamanho="sm" style={estilos.dicaTexto}>
            A chave também aparece no e-mail da nota fiscal. Digite só os números — pontos e espaços
            são ignorados.
          </Texto>
        </View>
      </Cartao>

      <Botao
        titulo="Validar chave"
        bloco
        desabilitado={!completa}
        carregando={salvando}
        onPress={() => void validar()}
        style={estilos.botao}
      />

      <Botao
        titulo="Voltar para a câmera"
        variante="fantasma"
        bloco
        onPress={() => navigation.replace('Scanner')}
      />
    </Tela>
  );
}

const estilos = StyleSheet.create({
  titulo: { fontSize: 24, letterSpacing: -0.7 },
  apoio: { fontSize: 13, lineHeight: 20, marginTop: espaco.xs + 2 },
  rotuloLinha: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: espaco.lg + 2,
    marginBottom: espaco.xs + 2,
  },
  contador: { fontSize: 11 },
  campo: {
    minHeight: 92,
    borderWidth: 1.5,
    borderRadius: raio.md,
    paddingHorizontal: 14,
    paddingVertical: espaco.md,
    fontSize: 15,
    lineHeight: 24,
    letterSpacing: 1.5,
    textAlignVertical: 'top',
    ...tabular,
  },
  dica: { marginTop: espaco.md, padding: 13 },
  dicaLinha: { flexDirection: 'row', gap: espaco.sm + 2 },
  dicaTexto: { flex: 1, fontSize: 12, lineHeight: 18 },
  botao: { marginTop: espaco.lg + 2, marginBottom: espaco.sm },
});
