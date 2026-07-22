/**
 * Redesign "3a" — cabeçalho com botão de voltar (nota, detalhe). Botão-ícone
 * quadrado (cartão + borda) que acompanha o tema.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { espaco, raio, useTema } from '@/tema';

import { IconeVoltar } from './icones';
import { Texto } from './Texto';

export interface CabecalhoVoltarProps {
  titulo: string;
  subtitulo?: string;
  aoVoltar: () => void;
}

export function CabecalhoVoltar({ titulo, subtitulo, aoVoltar }: CabecalhoVoltarProps) {
  const { c } = useTema();
  return (
    <View style={estilos.linha}>
      <Pressable
        onPress={aoVoltar}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        style={[estilos.botao, { backgroundColor: c.cartao, borderColor: c.borda }]}
      >
        <IconeVoltar tamanho={20} cor={c.tinta} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Texto peso="extrabold" tamanho="lg">
          {titulo}
        </Texto>
        {subtitulo ? (
          <Texto cor="fraco" tamanho="sm">
            {subtitulo}
          </Texto>
        ) : null}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.lg },
  botao: {
    width: 40,
    height: 40,
    borderRadius: raio.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
