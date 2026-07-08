/**
 * Redesign "2a" — Botão do design system. Três variantes:
 *   • primario   — teal preenchido + sombra teal (ação principal)
 *   • secundario — tealWash com borda tealBorda (ação alternativa)
 *   • fantasma   — só o label teal (ações terciárias/links)
 *
 * Lê as cores da paleta ativa (`useTema`), então funciona em claro e escuro.
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { espaco, raio, sombra, useTema, type Cor, type Paleta } from '@/tema';

import { Texto } from './Texto';

export type VarianteBotao = 'primario' | 'secundario' | 'fantasma';

export interface BotaoProps {
  titulo: string;
  onPress?: () => void;
  variante?: VarianteBotao;
  /** Ícone à esquerda do título. */
  icone?: ReactNode;
  carregando?: boolean;
  desabilitado?: boolean;
  /** Ocupa toda a largura disponível. */
  bloco?: boolean;
  style?: ViewStyle;
}

function variante(v: VarianteBotao, c: Paleta, pressed: boolean) {
  switch (v) {
    case 'primario':
      return { bg: pressed ? c.tealPressed : c.teal, fg: 'branco' as Cor, borda: undefined, sombra: true };
    case 'secundario':
      return { bg: c.tealWash, fg: 'teal' as Cor, borda: c.tealBorda, sombra: false };
    case 'fantasma':
      return { bg: 'transparent', fg: 'teal' as Cor, borda: undefined, sombra: false };
  }
}

export function Botao({
  titulo,
  onPress,
  variante: nomeVariante = 'primario',
  icone,
  carregando = false,
  desabilitado = false,
  bloco = false,
  style,
}: BotaoProps) {
  const { c } = useTema();
  const inativo = desabilitado || carregando;

  return (
    <Pressable
      onPress={onPress}
      disabled={inativo}
      accessibilityRole="button"
      style={({ pressed }) => {
        const v = variante(nomeVariante, c, pressed);
        return [
          estilos.base,
          {
            backgroundColor: v.bg,
            borderColor: v.borda,
            borderWidth: v.borda ? 1.5 : 0,
          },
          v.sombra && sombra.flutuante,
          bloco && estilos.bloco,
          inativo && estilos.atenuado,
          style,
        ];
      }}
    >
      {carregando ? (
        <ActivityIndicator color={c[variante(nomeVariante, c, false).fg]} />
      ) : (
        <View style={estilos.conteudo}>
          {icone}
          <Texto peso="extrabold" tamanho="md" cor={variante(nomeVariante, c, false).fg}>
            {titulo}
          </Texto>
        </View>
      )}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  base: {
    height: 54,
    borderRadius: raio.botao,
    paddingHorizontal: espaco.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bloco: { alignSelf: 'stretch' },
  atenuado: { opacity: 0.6 },
  conteudo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
});
