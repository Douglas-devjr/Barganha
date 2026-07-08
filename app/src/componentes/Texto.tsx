/**
 * Redesign "2a" — Texto com a fonte e a escala do design system. Lê a cor da
 * paleta ativa (`useTema`), então o mesmo `cor="tinta"` funciona em claro e
 * escuro. Em RN o `Text` NÃO herda cor de View/Pressable: toda cor é explícita.
 */

import { Text, type TextProps, type TextStyle } from 'react-native';

import { fontes, tamanhos, useTema, type Cor, type PesoFonte, type TamanhoTexto } from '@/tema';

export interface TextoProps extends TextProps {
  peso?: PesoFonte;
  tamanho?: TamanhoTexto;
  cor?: Cor;
  centralizado?: boolean;
}

export function Texto({
  peso = 'medium',
  tamanho = 'md',
  cor = 'tinta',
  centralizado = false,
  style,
  ...rest
}: TextoProps) {
  const { c } = useTema();
  const base: TextStyle = {
    fontFamily: fontes[peso],
    fontSize: tamanhos[tamanho],
    color: c[cor],
    ...(centralizado ? { textAlign: 'center' } : {}),
  };
  return <Text {...rest} style={[base, style]} />;
}
