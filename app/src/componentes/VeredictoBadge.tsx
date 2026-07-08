/**
 * Redesign "2a" — pílula SÓLIDA de veredito (barato / na média / caro / sem
 * dados). Fundo na cor do veredito, ponto branco à esquerda, texto branco,
 * sombra colorida. Usa o tipo `Veredito` de @barganha/shared (mesma classificação
 * do backend). A promoção nunca entra aqui — vai numa linha à parte.
 */

import type { Veredito } from '@barganha/shared';
import { StyleSheet, View } from 'react-native';

import { espaco, raio, useTema, veredito as mapaVeredito } from '@/tema';

import { Texto } from './Texto';

export interface VeredictoBadgeProps {
  veredito: Veredito;
  /** Sinaliza base pequena demais para confiar (ressalva de "poucos dados"). */
  poucosDados?: boolean;
  /** Versão compacta (para uso inline ao lado de um título). */
  pequeno?: boolean;
}

export function VeredictoBadge({ veredito, poucosDados = false, pequeno = false }: VeredictoBadgeProps) {
  const { c } = useTema();
  const v = mapaVeredito(c)[veredito];
  const rotulo = poucosDados ? `${v.rotulo} · poucos dados` : v.rotulo;

  return (
    <View
      style={[
        estilos.base,
        pequeno ? estilos.pequeno : estilos.grande,
        {
          backgroundColor: v.fg,
          shadowColor: v.fg,
        },
      ]}
    >
      <View style={[estilos.ponto, pequeno && estilos.pontoPequeno]} />
      <Texto peso="extrabold" tamanho={pequeno ? 'sm' : 'lg'} cor="branco">
        {rotulo}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: raio.pill,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  grande: { gap: espaco.sm, paddingVertical: 9, paddingHorizontal: espaco.lg },
  pequeno: { gap: 5, paddingVertical: 4, paddingHorizontal: espaco.sm + 2 },
  ponto: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#FFFFFF' },
  pontoPequeno: { width: 6, height: 6, borderRadius: 3 },
});
