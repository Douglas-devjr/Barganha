/**
 * C5.2 — Campo de texto do design system (rótulo + input + erro). Usado nas
 * telas de autenticação (C4.3.1) e reutilizável em formulários futuros.
 */

import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { cores, espaco, fontes, raio, tamanhos } from '@/tema';

import { Texto } from './Texto';

export interface CampoTextoProps extends TextInputProps {
  rotulo: string;
  /** Mensagem de erro exibida abaixo do campo (borda fica vermelha). */
  erro?: string;
}

export function CampoTexto({ rotulo, erro, style, onFocus, onBlur, ...rest }: CampoTextoProps) {
  const [focado, setFocado] = useState(false);

  return (
    <View style={estilos.raiz}>
      <Texto peso="semibold" tamanho="sm" cor="textoSuave" style={estilos.rotulo}>
        {rotulo}
      </Texto>
      <TextInput
        placeholderTextColor={cores.placeholder}
        {...rest}
        onFocus={(e) => {
          setFocado(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocado(false);
          onBlur?.(e);
        }}
        style={[
          estilos.input,
          focado && estilos.focado,
          erro != null && estilos.comErro,
          style,
        ]}
      />
      {erro != null ? (
        <Texto tamanho="sm" cor="caro" style={estilos.erro}>
          {erro}
        </Texto>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  raiz: { gap: espaco.xs },
  rotulo: { marginLeft: espaco.xs },
  input: {
    height: 54,
    borderRadius: raio.lg,
    paddingHorizontal: espaco.lg,
    backgroundColor: cores.superficie,
    borderWidth: 1.5,
    borderColor: cores.borda,
    color: cores.texto,
    fontFamily: fontes.medium,
    fontSize: tamanhos.md,
  },
  focado: { borderColor: cores.marcaBorda, backgroundColor: cores.marcaBgClaro },
  comErro: { borderColor: cores.caro },
  erro: { marginLeft: espaco.xs },
});
