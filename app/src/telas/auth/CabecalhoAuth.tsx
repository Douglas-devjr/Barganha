/** C4.3.1 — Cabeçalho comum das telas de autenticação (marca + título + apoio). */

import { StyleSheet, View } from 'react-native';

import { Texto } from '@/componentes';
import { espaco } from '@/tema';

export function CabecalhoAuth({ titulo, apoio }: { titulo: string; apoio: string }) {
  return (
    <View style={estilos.raiz}>
      <Texto peso="extrabold" tamanho="display" cor="teal">
        Barganha
      </Texto>
      <Texto peso="extrabold" tamanho="titulo" style={estilos.titulo}>
        {titulo}
      </Texto>
      <Texto cor="suave" style={estilos.apoio}>
        {apoio}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  raiz: { marginTop: espaco.xl, marginBottom: espaco.xl },
  titulo: { marginTop: espaco.xl, letterSpacing: -0.4 },
  apoio: { marginTop: espaco.sm, lineHeight: 22 },
});
