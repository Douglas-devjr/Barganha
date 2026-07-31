/**
 * C13.5 — O bloco que ocupa o lugar de um recurso do Barganha+ no plano grátis.
 *
 * Regra de UI de docs/21: **recurso bloqueado APARECE, não some.** Some é o
 * mesmo que não existir — o usuário não descobre o que está perdendo e o app
 * parece menor do que é. Então o lugar continua ocupado, com cadeado, dizendo em
 * uma linha o que há ali do outro lado.
 *
 * O texto é sempre a PRÉVIA DO VALOR concreta ("+4 mercados no ranking"), nunca
 * um anúncio genérico. A borda tracejada é o sinal visual de "continua aqui".
 */

import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { espaco, raio, useTema } from '@/tema';

import { IconeCadeado } from './icones';
import { TileIcone } from './layout3a';
import { Texto } from './Texto';

export interface BloqueioPlusProps {
  /** O que está bloqueado, do ponto de vista do usuário. */
  titulo: string;
  /** A prévia do valor: o que ele veria. Uma linha, concreta. */
  texto: string;
  /** Abre a folha do Barganha+ (normalmente `mostrarPlus` do `usePlano`). */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function BloqueioPlus({ titulo, texto, onPress, style }: BloqueioPlusProps) {
  const { c } = useTema();

  const conteudo = (
    <>
      <TileIcone>
        <IconeCadeado tamanho={16} cor={c.suave} />
      </TileIcone>
      <View style={estilos.texto}>
        <Texto peso="semibold" tamanho="sm" numberOfLines={1}>
          {titulo}
        </Texto>
        <Texto cor="fraco" tamanho="xs" style={estilos.subtitulo}>
          {texto}
        </Texto>
      </View>
      <SeloPlus />
    </>
  );

  const estilo = [estilos.caixa, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }, style];

  if (!onPress) return <View style={estilo}>{conteudo}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${titulo}. ${texto}. Disponível no Barganha+`}
      style={({ pressed }) => [...estilo, pressed && { opacity: 0.6 }]}
    >
      {conteudo}
    </Pressable>
  );
}

/** Pílula "Barganha+" — a marca do plano, na tinta (o 3a não tem cor de marca). */
export function SeloPlus() {
  const { c } = useTema();
  return (
    <View style={[estilos.selo, { backgroundColor: c.teal }]}>
      <Texto peso="bold" style={[estilos.seloTexto, { color: c.sobreTeal }]}>
        Barganha+
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  caixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    borderRadius: raio.cartao,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 44,
  },
  texto: { flex: 1 },
  subtitulo: { marginTop: 2 },
  selo: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: raio.pill },
  seloTexto: { fontSize: 10.5, letterSpacing: 0.2 },
});
