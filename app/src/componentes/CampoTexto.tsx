/**
 * Redesign "3a" — campo de texto (rótulo + input + erro). Lê as cores do tema
 * ativo; o foco realça com borda `tinta` de 1.5px (handoff 3a) sobre o fundo de
 * campo (`superficie`/fld). Usado nas telas de auth e no editor de região.
 *
 * `senha` liga o campo de senha do handoff: mascara o texto e mostra o olho de
 * revelar à direita (alvo de 44px, como manda a regra de toque).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { espaco, fontes, raio, tamanhos, useTema } from '@/tema';

import { IconeOlho, IconeOlhoFechado } from './icones';
import { Texto } from './Texto';

export interface CampoTextoProps extends TextInputProps {
  rotulo: string;
  /** Mensagem de erro exibida abaixo do campo (borda fica vermelha). */
  erro?: string;
  /** Campo de senha: mascara o valor e mostra o olho de revelar (handoff 3a). */
  senha?: boolean;
}

export function CampoTexto({
  rotulo,
  erro,
  senha = false,
  style,
  onFocus,
  onBlur,
  ...rest
}: CampoTextoProps) {
  const { c } = useTema();
  const [focado, setFocado] = useState(false);
  const [revelada, setRevelada] = useState(false);

  const borda = erro != null ? c.caro : focado ? c.tinta : c.borda;

  const input = (
    <TextInput
      placeholderTextColor={c.fraco}
      secureTextEntry={senha && !revelada}
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
        senha ? estilos.inputSenha : null,
        { color: c.tinta },
        !senha && { backgroundColor: c.superficie, borderColor: borda, borderWidth: 1.5 },
        style,
      ]}
    />
  );

  return (
    <View style={estilos.raiz}>
      <Texto peso="semibold" tamanho="sm" cor="suave" style={estilos.rotulo}>
        {rotulo}
      </Texto>

      {senha ? (
        <View style={[estilos.molduraSenha, { backgroundColor: c.superficie, borderColor: borda }]}>
          {input}
          <Pressable
            onPress={() => setRevelada((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={revelada ? 'Ocultar senha' : 'Mostrar senha'}
            style={estilos.olho}
          >
            {revelada ? (
              <IconeOlhoFechado tamanho={19} cor={c.fraco} />
            ) : (
              <IconeOlho tamanho={19} cor={c.fraco} />
            )}
          </Pressable>
        </View>
      ) : (
        input
      )}

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
    fontFamily: fontes.medium,
    fontSize: tamanhos.md,
  },
  // No campo de senha a borda vive na moldura (o input fica chapado dentro).
  inputSenha: { flex: 1, paddingRight: espaco.sm },
  molduraSenha: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: raio.md,
    borderWidth: 1.5,
  },
  olho: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  erro: { marginLeft: espaco.xs },
});
