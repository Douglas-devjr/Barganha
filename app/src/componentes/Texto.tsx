/**
 * C5.2 — Texto com a fonte e a escala do design system. Centraliza a tipografia
 * para nenhuma tela precisar lembrar nomes de `fontFamily`.
 */

import { Text, type TextProps, type TextStyle } from 'react-native';

import { cores, fontes, tamanhos, type Cor, type PesoFonte, type TamanhoTexto } from '@/tema';

export interface TextoProps extends TextProps {
  peso?: PesoFonte;
  tamanho?: TamanhoTexto;
  cor?: Cor;
  centralizado?: boolean;
}

export function Texto({
  peso = 'medium',
  tamanho = 'md',
  cor = 'texto',
  centralizado = false,
  style,
  ...rest
}: TextoProps) {
  const base: TextStyle = {
    fontFamily: fontes[peso],
    fontSize: tamanhos[tamanho],
    color: cores[cor],
    ...(centralizado ? { textAlign: 'center' } : {}),
  };
  return <Text {...rest} style={[base, style]} />;
}
