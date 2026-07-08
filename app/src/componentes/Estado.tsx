/**
 * Redesign "2a" — bloco de estado (vazio / erro / offline): ícone em círculo +
 * título + texto de apoio + ação opcional. Funciona em claro e escuro; o círculo
 * usa o tom teal (padrão) ou âmbar (avisos/erro).
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { espaco, useTema } from '@/tema';

import { Botao, type VarianteBotao } from './Botao';
import { Texto } from './Texto';

export interface EstadoAcao {
  titulo: string;
  onPress: () => void;
  variante?: VarianteBotao;
}

export interface EstadoProps {
  /** Ícone já colorido (passe a cor do tom escolhido). */
  icone: ReactNode;
  titulo: string;
  texto?: string;
  /** Tom do círculo do ícone. */
  tom?: 'teal' | 'ambar';
  acao?: EstadoAcao;
  acaoSecundaria?: EstadoAcao;
}

export function Estado({ icone, titulo, texto, tom = 'teal', acao, acaoSecundaria }: EstadoProps) {
  const { c } = useTema();
  const fundoIcone = tom === 'ambar' ? c.ambarBg : c.tealWash2;

  return (
    <View style={estilos.raiz}>
      <View style={[estilos.circulo, { backgroundColor: fundoIcone }]}>{icone}</View>
      <Texto peso="extrabold" tamanho="lg" centralizado style={{ marginTop: espaco.md }}>
        {titulo}
      </Texto>
      {texto ? (
        <Texto cor="suave" centralizado style={estilos.texto}>
          {texto}
        </Texto>
      ) : null}
      {acao ? (
        <Botao
          titulo={acao.titulo}
          variante={acao.variante ?? 'primario'}
          onPress={acao.onPress}
          style={estilos.acao}
        />
      ) : null}
      {acaoSecundaria ? (
        <Botao
          titulo={acaoSecundaria.titulo}
          variante={acaoSecundaria.variante ?? 'fantasma'}
          onPress={acaoSecundaria.onPress}
          style={estilos.acaoSecundaria}
        />
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  raiz: { alignItems: 'center', paddingVertical: espaco.lg },
  circulo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: { marginTop: espaco.xs, maxWidth: 300, lineHeight: 20 },
  acao: { marginTop: espaco.lg, alignSelf: 'stretch' },
  acaoSecundaria: { marginTop: espaco.xs, alignSelf: 'stretch' },
});
