/**
 * Redesign "3a" — os padrões de layout que o protótipo repete em quase toda
 * tela. Ficam aqui para as telas não recopiarem medida:
 *
 *  • `Eyebrow`       — legenda MAIÚSCULA 10.5/600, tracking 1.3
 *  • `TituloTela`    — 26/700/-0.8 com um slot à direita
 *  • `TileIcone`     — quadrado 38px raio 10 no `linha` (fundo de ícone)
 *  • `CartaoLista`   — cartão raio 16 com padding 4/14, para empilhar linhas
 *  • `LinhaLista`    — a linha padrão: tile + título/subtítulo + direita + chevron
 *
 * Medidas retiradas do protótipo (`Barganha - Protótipo (referência).dc.html`).
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { espaco, raio, useTema } from '@/tema';

import { IconeChevron } from './icones';
import { Texto } from './Texto';

/** Legenda MAIÚSCULA acima de um número/seção. */
export function Eyebrow({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Texto peso="semibold" cor="fraco" style={[estilos.eyebrow, style]}>
      {children}
    </Texto>
  );
}

/** Título de tela (26/700/-0.8) com um slot opcional à direita. */
export function TituloTela({ titulo, direita }: { titulo: string; direita?: ReactNode }) {
  return (
    <View style={estilos.tituloLinha}>
      <Texto peso="bold" tamanho="titulo" style={estilos.titulo}>
        {titulo}
      </Texto>
      {direita}
    </View>
  );
}

/** Quadrado de ícone 38×38 (raio 10) — o "tile" do 3a. */
export function TileIcone({ children }: { children: ReactNode }) {
  const { c } = useTema();
  return <View style={[estilos.tile, { backgroundColor: c.linha }]}>{children}</View>;
}

/**
 * Cartão que agrupa linhas. O padding vertical menor (4) é de propósito: quem
 * dá o respiro é o padding das linhas, para as divisórias irem de ponta a ponta.
 */
export function CartaoLista({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTema();
  return (
    <View
      style={[
        estilos.cartaoLista,
        { backgroundColor: c.cartao, borderColor: c.cartaoBorda },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export interface LinhaListaProps {
  titulo: string;
  subtitulo?: string;
  /** Ícone do tile à esquerda; sem ele a linha começa no texto. */
  icone?: ReactNode;
  /** Bloco à direita, antes do chevron (preço, contador, switch…). */
  direita?: ReactNode;
  onPress?: () => void;
  /** Mostra o chevron de avançar (só faz sentido com `onPress`). */
  chevron?: boolean;
  /** A última linha do cartão não leva divisória. */
  ultima?: boolean;
  destrutiva?: boolean;
}

export function LinhaLista({
  titulo,
  subtitulo,
  icone,
  direita,
  onPress,
  chevron = false,
  ultima = false,
  destrutiva = false,
}: LinhaListaProps) {
  const { c } = useTema();

  const conteudo = (
    <>
      {icone ? <TileIcone>{icone}</TileIcone> : null}
      <View style={estilos.linhaTexto}>
        <Texto
          peso="semibold"
          tamanho="sm"
          numberOfLines={1}
          style={destrutiva ? { color: c.caro } : undefined}
        >
          {titulo}
        </Texto>
        {subtitulo ? (
          <Texto cor="fraco" tamanho="xs" numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitulo}
          </Texto>
        ) : null}
      </View>
      {direita}
      {chevron ? <IconeChevron tamanho={16} cor={c.fraco} /> : null}
    </>
  );

  const estilo = [estilos.linha, !ultima && { borderBottomWidth: 1, borderBottomColor: c.linha }];

  if (!onPress) return <View style={estilo}>{conteudo}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [...estilo, pressed && { opacity: 0.6 }]}
    >
      {conteudo}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  eyebrow: { fontSize: 10.5, letterSpacing: 1.3, textTransform: 'uppercase' },
  tituloLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
  },
  titulo: { letterSpacing: -0.8 },
  tile: {
    width: 38,
    height: 38,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartaoLista: {
    borderRadius: raio.cartao,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: 13,
    minHeight: 44,
  },
  linhaTexto: { flex: 1 },
});
