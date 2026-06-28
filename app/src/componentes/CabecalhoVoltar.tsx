/**
 * C5.2 — Cabeçalho com botão de voltar para telas de fluxo (nota, detalhe). Usa
 * o estilo de "botão-ícone" branco com borda do protótipo.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { cores, espaco, raio } from '@/tema';

import { IconeVoltar } from './icones';
import { Texto } from './Texto';

export interface CabecalhoVoltarProps {
  titulo: string;
  subtitulo?: string;
  aoVoltar: () => void;
}

export function CabecalhoVoltar({ titulo, subtitulo, aoVoltar }: CabecalhoVoltarProps) {
  return (
    <View style={estilos.linha}>
      <Pressable
        onPress={aoVoltar}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        style={estilos.botao}
      >
        <IconeVoltar tamanho={20} cor={cores.texto} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Texto peso="extrabold" tamanho="lg">
          {titulo}
        </Texto>
        {subtitulo ? (
          <Texto cor="placeholder" tamanho="sm">
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
    backgroundColor: cores.superficie,
    borderWidth: 1,
    borderColor: cores.borda,
  },
});
