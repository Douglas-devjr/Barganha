/**
 * C5.2 — Botão do design system. Três variantes do protótipo:
 *   • primario   — teal preenchido (ação principal)
 *   • secundario — teal claro com borda (ação alternativa)
 *   • fantasma   — sem fundo (ações terciárias/links)
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { cores, espaco, raio, type Cor } from '@/tema';

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

const VARIANTES: Record<VarianteBotao, { bg: string; fg: Cor; borda?: string }> = {
  primario: { bg: cores.marca, fg: 'branco' },
  secundario: { bg: cores.marcaBgClaro, fg: 'marca', borda: cores.marcaBorda },
  fantasma: { bg: 'transparent', fg: 'marca' },
};

export function Botao({
  titulo,
  onPress,
  variante = 'primario',
  icone,
  carregando = false,
  desabilitado = false,
  bloco = false,
  style,
}: BotaoProps) {
  const v = VARIANTES[variante];
  const inativo = desabilitado || carregando;

  return (
    <Pressable
      onPress={onPress}
      disabled={inativo}
      accessibilityRole="button"
      style={({ pressed }) => [
        estilos.base,
        { backgroundColor: v.bg, borderColor: v.borda, borderWidth: v.borda ? 1.5 : 0 },
        bloco && estilos.bloco,
        (pressed || inativo) && estilos.atenuado,
        style,
      ]}
    >
      {carregando ? (
        <ActivityIndicator color={cores[v.fg]} />
      ) : (
        <View style={estilos.conteudo}>
          {icone}
          <Texto peso="bold" cor={v.fg}>
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
    borderRadius: raio.lg,
    paddingHorizontal: espaco.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bloco: { alignSelf: 'stretch' },
  atenuado: { opacity: 0.7 },
  conteudo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
});
