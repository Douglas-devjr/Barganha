/**
 * C6.4 — Onboarding (3 passos) + consentimento LGPD. As duas primeiras telas
 * explicam o produto; a terceira pede o consentimento explícito e só então
 * libera o próximo gate — o LOGIN (C4.3.1) — e, depois dele, o app (decisão
 * travada: transparência sobre o que se coleta — preços anônimos — e o que nunca
 * se coleta — dados pessoais, docs/04).
 *
 * O consentimento é gravado localmente (meta_sync); o gate de App.tsx decide o
 * que renderizar a partir dele. Sem "Concordar", não há login nem captura.
 */

import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Botao,
  IconePerfil,
  IconeScan,
  IconeVerificar,
  Texto,
  type IconeProps,
} from '@/componentes';
import { meta } from '@/dados';
import { cores, espaco, raio } from '@/tema';

export interface OnboardingTelaProps {
  /** Chamado após registrar o consentimento — o gate avança para o login. */
  aoConcordar: () => void;
}

interface Passo {
  Icone: (p: IconeProps) => ReactElement;
  titulo: string;
  descricao: string;
}

const PASSOS: Passo[] = [
  {
    Icone: IconeScan,
    titulo: 'Escaneie o cupom',
    descricao:
      'Aponte para o QR Code da nota fiscal. A gente lê os preços por você — funciona até sem internet.',
  },
  {
    Icone: IconeVerificar,
    titulo: 'Saiba o preço justo',
    descricao:
      'Na gôndola, veja na hora se o produto está barato, na média ou caro — sempre por unidade comparável (kg, L, un).',
  },
  {
    Icone: IconePerfil,
    titulo: 'Privacidade por design',
    descricao:
      'Os preços que você compartilha entram anônimos e soltos. Nunca guardamos nome, CPF ou qualquer ligação com você (LGPD).',
  },
];

export function OnboardingTela({ aoConcordar }: OnboardingTelaProps) {
  const { width } = useWindowDimensions();
  const [indice, setIndice] = useState(0);
  const lista = useRef<FlatList<Passo>>(null);
  const ultimo = indice === PASSOS.length - 1;

  function irPara(i: number) {
    lista.current?.scrollToIndex({ index: i, animated: true });
    setIndice(i);
  }

  async function concordar() {
    await meta.registrarConsentimento();
    aoConcordar();
  }

  function avancar() {
    if (ultimo) void concordar();
    else irPara(indice + 1);
  }

  return (
    <SafeAreaView style={estilos.raiz} edges={['top', 'bottom']}>
      <View style={estilos.topo}>
        {ultimo ? (
          <View style={estilos.pular} />
        ) : (
          <Pressable
            onPress={() => irPara(PASSOS.length - 1)}
            accessibilityRole="button"
            style={estilos.pular}
          >
            <Texto cor="textoMudo" peso="semibold">
              Pular
            </Texto>
          </Pressable>
        )}
      </View>

      <FlatList
        ref={lista}
        data={PASSOS}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndice(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={[estilos.pagina, { width }]}>
            <View style={estilos.circulo}>
              <item.Icone tamanho={64} cor={cores.marca} larguraTraco={2} />
            </View>
            <Texto
              peso="extrabold"
              tamanho="display"
              centralizado
              style={{ marginTop: espaco.xxl }}
            >
              {item.titulo}
            </Texto>
            <Texto cor="textoSuave" centralizado style={estilos.descricao}>
              {item.descricao}
            </Texto>
          </View>
        )}
      />

      <View style={estilos.rodape}>
        <View style={estilos.pontos}>
          {PASSOS.map((_, i) => (
            <View key={i} style={[estilos.ponto, i === indice && estilos.pontoAtivo]} />
          ))}
        </View>
        <Botao titulo={ultimo ? 'Concordar e começar' : 'Continuar'} bloco onPress={avancar} />
      </View>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: cores.fundo },
  topo: { height: 40, justifyContent: 'center', paddingHorizontal: espaco.xl },
  pular: {
    alignSelf: 'flex-end',
    minWidth: 44,
    alignItems: 'flex-end',
    paddingVertical: espaco.xs,
  },
  pagina: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xxl,
  },
  circulo: {
    width: 132,
    height: 132,
    borderRadius: raio.pill,
    backgroundColor: cores.marcaBgMedio,
    alignItems: 'center',
    justifyContent: 'center',
  },
  descricao: { marginTop: espaco.md, maxWidth: 320, lineHeight: 22 },
  rodape: { paddingHorizontal: espaco.xl, paddingBottom: espaco.lg, gap: espaco.lg },
  pontos: { flexDirection: 'row', justifyContent: 'center', gap: espaco.sm },
  ponto: {
    width: 8,
    height: 8,
    borderRadius: raio.pill,
    backgroundColor: cores.bordaForte,
  },
  pontoAtivo: { backgroundColor: cores.marca, width: 22 },
});
