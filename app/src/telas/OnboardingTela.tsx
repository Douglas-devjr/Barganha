/**
 * C6.4 + Redesign "3a" — Onboarding (3 slides) + consentimento LGPD.
 *
 * Visual do handoff: canvas `fundo`, ícone em quadrado de TINTA (raio 28) ao
 * centro, título 25/700, apoio 14/1.55 em `suave`, dots de 8px (ativo opaco,
 * inativos a 0.25) e o botão primário no rodapé. "Pular" no topo à direita.
 *
 * DIFERENÇA CONSCIENTE em relação ao handoff: os 3 slides do protótipo são só
 * de produto, mas o consentimento é gate travado (decisão #3 / docs/04) — sem
 * ele não há login nem captura. Em vez de inventar um 4º slide (o handoff pede
 * 3 dots), o último slide traz a divulgação do que se coleta e o botão vira
 * "Concordar e começar": a ação afirmativa e informada continua existindo.
 */

import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Botao,
  IconeScan,
  IconeTrofeu,
  IconeVerificar,
  Texto,
  type IconeProps,
} from '@/componentes';
import { meta } from '@/dados';
import { espaco, raio, useTema } from '@/tema';

export interface OnboardingTelaProps {
  /** Chamado após registrar o consentimento — o gate avança para o login. */
  aoConcordar: () => void;
}

interface Passo {
  Icone: (p: IconeProps) => ReactElement;
  titulo: string;
  descricao: string;
}

/** Copy do handoff 3a (README, seção "Onboarding"). */
const PASSOS: Passo[] = [
  {
    Icone: IconeScan,
    titulo: 'Escaneie seus cupons',
    descricao: 'Cada cupom fiscal (NFC-e) vira dado de preço da sua região, de forma anônima.',
  },
  {
    Icone: IconeVerificar,
    titulo: 'Veja se vale a barganha',
    descricao: 'Compare o preço da gôndola com o típico da região antes de pôr no carrinho.',
  },
  {
    Icone: IconeTrofeu,
    titulo: 'Economize todo mês',
    descricao: 'Receba alertas quando um produto baixa e ganhe conquistas pela sua economia.',
  },
];

export function OnboardingTela({ aoConcordar }: OnboardingTelaProps) {
  const { c } = useTema();
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
    <SafeAreaView style={[estilos.raiz, { backgroundColor: c.fundo }]} edges={['top', 'bottom']}>
      <View style={estilos.topo}>
        {ultimo ? (
          <View style={estilos.pular} />
        ) : (
          <Pressable
            onPress={() => irPara(PASSOS.length - 1)}
            accessibilityRole="button"
            hitSlop={8}
            style={estilos.pular}
          >
            <Texto cor="suave" peso="semibold" tamanho="sm">
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
            <View style={[estilos.quadrado, { backgroundColor: c.tinta }]}>
              <item.Icone tamanho={44} cor={c.sobreTeal} larguraTraco={2} />
            </View>
            <Texto peso="bold" centralizado style={estilos.titulo}>
              {item.titulo}
            </Texto>
            <Texto cor="suave" centralizado style={estilos.descricao}>
              {item.descricao}
            </Texto>
          </View>
        )}
      />

      <View style={estilos.rodape}>
        {/* Divulgação do consentimento: só no último passo, junto da ação. */}
        {ultimo ? (
          <Texto cor="fraco" tamanho="xs" centralizado style={estilos.consentimento}>
            Ao começar, você concorda em compartilhar os preços dos seus cupons de forma anônima.
            Nunca guardamos nome, CPF ou qualquer ligação com você (LGPD).
          </Texto>
        ) : null}

        <View style={estilos.pontos}>
          {PASSOS.map((_, i) => (
            <View
              key={i}
              style={[
                estilos.ponto,
                { backgroundColor: c.tinta, opacity: i === indice ? 1 : 0.25 },
              ]}
            />
          ))}
        </View>

        <Botao titulo={ultimo ? 'Concordar e começar' : 'Próximo'} bloco onPress={avancar} />
      </View>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1 },
  topo: { height: 44, justifyContent: 'center', paddingHorizontal: espaco.tela },
  pular: {
    alignSelf: 'flex-end',
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  pagina: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xxl,
  },
  // quadrado `chip` do handoff: 96px, raio 28
  quadrado: {
    width: 96,
    height: 96,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titulo: { fontSize: 25, letterSpacing: -0.5, marginTop: espaco.xxl },
  descricao: { fontSize: 14, lineHeight: 22, marginTop: espaco.md, maxWidth: 300 },
  rodape: { paddingHorizontal: espaco.tela, paddingBottom: espaco.lg, gap: espaco.lg },
  consentimento: { lineHeight: 16, maxWidth: 320, alignSelf: 'center' },
  pontos: { flexDirection: 'row', justifyContent: 'center', gap: espaco.sm },
  ponto: { width: 8, height: 8, borderRadius: raio.pill },
});
