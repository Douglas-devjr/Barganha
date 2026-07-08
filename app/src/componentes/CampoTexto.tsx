/**
 * Redesign "2a" — campo de texto (rótulo + input + erro). Lê as cores do tema
 * ativo; foco realça com `tealBorda`/`tealWash`. Usado nas telas de auth e no
 * editor de região.
 */

import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { espaco, fontes, raio, tamanhos, useTema } from '@/tema';

import { Texto } from './Texto';

export interface CampoTextoProps extends TextInputProps {
  rotulo: string;
  /** Mensagem de erro exibida abaixo do campo (borda fica vermelha). */
  erro?: string;
}

export function CampoTexto({ rotulo, erro, style, onFocus, onBlur, ...rest }: CampoTextoProps) {
  const { c } = useTema();
  const [focado, setFocado] = useState(false);

  const borda = erro != null ? c.caro : focado ? c.tealBorda : c.borda;

  return (
    <View style={estilos.raiz}>
      <Texto peso="semibold" tamanho="sm" cor="suave" style={estilos.rotulo}>
        {rotulo}
      </Texto>
      <TextInput
        placeholderTextColor={c.fraco}
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
          {
            backgroundColor: focado ? c.tealWash : c.cartao,
            borderColor: borda,
            color: c.tinta,
          },
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
    borderRadius: raio.md,
    paddingHorizontal: espaco.lg,
    borderWidth: 1.5,
    fontFamily: fontes.medium,
    fontSize: tamanhos.md,
  },
  erro: { marginLeft: espaco.xs },
});
