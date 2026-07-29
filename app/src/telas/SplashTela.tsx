/**
 * Handoff "3k Construção" (`design/design_handoff_barganha_marca/HANDOFF-LOADING.md`)
 * — a tela de abertura do app.
 *
 * Não é um spinner: a marca SE CONSTRÓI. A haste cresce, os dois bojos brotam
 * dela em sequência e o conjunto termina no monograma inteiro (ícone "3b
 * Degrau"). O movimento é a própria hierarquia do B — é a assinatura da marca,
 * não um indicador de progresso.
 *
 * A tela NÃO acompanha o tema: é sempre escura, em claro e escuro. Por isso os
 * hex literais aqui em cima em vez de `useTema()` — os tokens `fundo`/`tinta`
 * invertem entre as paletas e a abertura viraria branca no tema claro, com dois
 * problemas: o flash branco de tela cheia no boot e a quebra da continuidade com
 * o splash NATIVO do Expo (`app.json` → `splash.backgroundColor`).
 *
 * Duas camadas cobrem a abertura, com a mesma cor de fundo e sem salto entre
 * elas: o splash nativo cobre o boot do JS; esta tela cobre o resto (fonte,
 * SQLite, sessão) e segura o mínimo de 1,9 s.
 */

import { StatusBar } from 'expo-status-bar';
import { useEffect, useId, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Texto } from '@/componentes';
import { useReduzirMovimento } from '@/componentes/movimento';

/** §3 do handoff — literais fixos: a abertura não acompanha o tema. */
const FUNDO = '#111110';
const MARCA = '#F0F0EE';
const TAGLINE = 'rgba(255,255,255,0.5)';

/** Tempo total da tela, em ms (§5). Depois disso, entra o app. */
export const DURACAO_ABERTURA = 1900;

/** Caixa da marca (§2) e conversão do grid 100 × 100 do handoff para px. */
const CAIXA = 96;
const u = (n: number) => (n / 100) * CAIXA;

/** Círculos decorativos dos cantos (§2). */
const BRILHO = 260;

/** Curvas do §5 — a dos bojos passa de 1 de propósito (o "pop" ao brotar). */
const CURVA_HASTE = Easing.bezier(0.3, 0.9, 0.3, 1);
const CURVA_BOJO = Easing.bezier(0.25, 1.5, 0.4, 1);

export interface SplashTelaProps {
  /**
   * Chamado quando a abertura cumpriu seu tempo (ou o usuário tocou para pular).
   * Ausente = tela estática: a marca aparece pronta e nada é agendado.
   */
  aoConcluir?: () => void;
  /**
   * `false` mostra o monograma completo, sem construção. Usado nas esperas
   * curtas DEPOIS da abertura (sessão, estado do aparelho), para continuar a
   * mesma tela sem reiniciar a animação.
   */
  animar?: boolean;
}

export function SplashTela({ aoConcluir, animar = true }: SplashTelaProps) {
  const reduzirMovimento = useReduzirMovimento();
  // §5: com "reduzir movimento" a marca aparece pronta — o estado final é o
  // mesmo, só não há construção.
  const construir = animar && !reduzirMovimento;

  // Um valor 0→1 por elemento. Ficam em ref: re-render (ex.: a fonte terminando
  // de carregar) não pode reiniciar a construção.
  const passos = useRef({
    tela: new Animated.Value(0),
    haste: new Animated.Value(0),
    bojoSuperior: new Animated.Value(0),
    bojoInferior: new Animated.Value(0),
    wordmark: new Animated.Value(0),
  }).current;

  const jaConcluiu = useRef(false);
  const concluir = useRef(aoConcluir);
  concluir.current = aoConcluir;

  /** Idempotente: o toque e o timer disputam quem termina primeiro. */
  function terminar() {
    if (jaConcluiu.current) return;
    jaConcluiu.current = true;
    concluir.current?.();
  }

  useEffect(() => {
    const timing = (
      valor: Animated.Value,
      duracao: number,
      atraso: number,
      curva: typeof CURVA_HASTE,
    ) =>
      Animated.timing(valor, {
        toValue: 1,
        duration: duracao,
        delay: atraso,
        easing: curva,
        useNativeDriver: true,
      });

    // §5 — a tabela do handoff, linha por linha.
    const construcao = construir
      ? Animated.parallel([
          timing(passos.tela, 300, 0, Easing.ease),
          timing(passos.haste, 420, 0, CURVA_HASTE),
          timing(passos.bojoSuperior, 380, 340, CURVA_BOJO),
          timing(passos.bojoInferior, 380, 520, CURVA_BOJO),
          timing(passos.wordmark, 500, 740, Easing.ease),
        ])
      : null;

    if (construcao) construcao.start();
    // Sem construção: o estado final, de imediato. O TEMPO da tela não muda —
    // "reduzir movimento" desliga a animação, não a abertura.
    else Object.values(passos).forEach((valor) => valor.setValue(1));

    // A construção acaba em 1,24 s; a tela segura até 1,9 s antes de sair.
    // Sem `aoConcluir` a tela é decorativa (espera curta) e não agenda nada.
    const relogio = concluir.current ? setTimeout(terminar, DURACAO_ABERTURA) : undefined;
    return () => {
      construcao?.stop();
      if (relogio) clearTimeout(relogio);
    };
    // Depende só de `construir`: a construção não se refaz a cada render (os
    // `passos` moram em ref e `aoConcluir`/`terminar` passam por ref também).
  }, [construir]);

  /** Opacidade nunca passa de 1 — a curva dos bojos ultrapassa (é o overshoot). */
  const opacidade = (valor: Animated.Value) =>
    valor.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    // `accessible={false}`: o toque é um atalho para pular a espera, não um
    // controle rotulado — o leitor de tela deve ler a marca e a tagline.
    <Pressable style={estilos.raiz} onPress={terminar} accessible={false}>
      {/* A tela é escura nos dois temas: sobrepõe a barra de status do app,
          que segue o tema e sumiria contra o fundo no modo claro. */}
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: opacidade(passos.tela) }]}>
        <Brilho opacidade={0.1} posicao={{ top: -80, right: -70 }} />
        <Brilho opacidade={0.07} posicao={{ bottom: -90, left: -70 }} />

        <View style={estilos.centro}>
          <View style={estilos.caixaMarca}>
            {/* Haste: cresce de cima para baixo. O recorte reproduz o keyframe
                `height: 0 → 68%` sem sair do driver nativo (animar `height`
                seria animação em JS, logo travada durante o boot). */}
            <View style={estilos.haste}>
              <Animated.View
                style={[
                  estilos.hasteBarra,
                  {
                    transform: [
                      {
                        translateY: passos.haste.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-u(68), 0],
                        }),
                      },
                    ],
                  },
                ]}
              />
            </View>

            {/* Bojos: brotam DA HASTE — origem à esquerda, não no próprio centro. */}
            <Animated.View
              style={[
                estilos.bojoSuperior,
                {
                  opacity: opacidade(passos.bojoSuperior),
                  transform: [{ scale: passos.bojoSuperior }],
                },
              ]}
            >
              <Svg width={u(22.5)} height={u(32)} viewBox="0 0 22.5 32" preserveAspectRatio="none">
                <Path d="M0 0h6.5a16 16 0 0 1 0 32H0z" fill={MARCA} />
              </Svg>
            </Animated.View>

            <Animated.View
              style={[
                estilos.bojoInferior,
                {
                  opacity: opacidade(passos.bojoInferior),
                  transform: [{ scale: passos.bojoInferior }],
                },
              ]}
            >
              <Svg width={u(34)} height={u(34)} viewBox="0 0 34 34" preserveAspectRatio="none">
                <Path d="M0 0h17a17 17 0 0 1 0 34H0z" fill={MARCA} />
              </Svg>
            </Animated.View>
          </View>

          <Animated.View
            style={{
              opacity: opacidade(passos.wordmark),
              transform: [
                {
                  scale: passos.wordmark.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1],
                  }),
                },
              ],
            }}
          >
            <Texto peso="bold" style={estilos.wordmark}>
              Barganha
            </Texto>
          </Animated.View>
        </View>

        <Texto peso="medium" centralizado style={estilos.tagline}>
          Saiba se o preço vale a barganha
        </Texto>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Círculo decorativo dos cantos: o `radial-gradient` do §2. Desenhado em PIXELS
 * — porcentagem em `Svg` absoluto não resolve de forma confiável (mesma pegadinha
 * do `GradienteLinear`).
 */
function Brilho({ opacidade, posicao }: { opacidade: number; posicao: ViewStyle }) {
  // useId() traz `:`, inválido numa referência url(#id) de SVG.
  const id = 'brilho' + useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <View style={[estilos.brilho, posicao]} pointerEvents="none">
      <Svg width={BRILHO} height={BRILHO}>
        <Defs>
          <RadialGradient
            id={id}
            cx={BRILHO / 2}
            cy={BRILHO / 2}
            r={BRILHO / 2}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={opacidade} />
            <Stop offset="0.7" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={BRILHO} height={BRILHO} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: FUNDO },
  brilho: { position: 'absolute', width: BRILHO, height: BRILHO },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },

  caixaMarca: { width: CAIXA, height: CAIXA },
  // Grid 100 × 100 do §4: haste x 24→39, y 16→84.
  haste: {
    position: 'absolute',
    left: u(24),
    top: u(16),
    width: u(15),
    height: u(68),
    overflow: 'hidden',
  },
  hasteBarra: { width: '100%', height: '100%', backgroundColor: MARCA },
  bojoSuperior: {
    position: 'absolute',
    left: u(39),
    top: u(16),
    transformOrigin: 'left center',
  },
  bojoInferior: {
    position: 'absolute',
    left: u(39),
    top: u(50),
    transformOrigin: 'left center',
  },

  wordmark: { fontSize: 30, letterSpacing: -1, color: MARCA },
  tagline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 40,
    fontSize: 12,
    color: TAGLINE,
  },
});
