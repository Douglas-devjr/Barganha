/**
 * Redesign "3a" — pílula de veredito (barato / na média / caro / sem dados).
 * Fundo no wash do veredito, texto e ponto na cor do veredito, contorno de
 * 1.5px. Chapada, sem sombra (o 3a é flat). Usa o tipo `Veredito` de
 * @barganha/shared (mesma classificação do backend). A promoção nunca entra
 * aqui — vai numa linha à parte.
 */

import type { Veredito } from '@barganha/shared';
import { StyleSheet, View } from 'react-native';

import { espaco, raio, useTema, veredito as mapaVeredito } from '@/tema';

import { Texto } from './Texto';

export interface VeredictoBadgeProps {
  veredito: Veredito;
  /** Sinaliza base pequena demais para confiar (ressalva de "poucos dados"). */
  poucosDados?: boolean;
  /** Típico velho ou de idade desconhecida — ressalva de "pode estar desatualizado". */
  dadoVelho?: boolean;
  /** Versão compacta (para uso inline ao lado de um título). */
  pequeno?: boolean;
}

export function VeredictoBadge({
  veredito,
  poucosDados = false,
  dadoVelho = false,
  pequeno = false,
}: VeredictoBadgeProps) {
  const { c } = useTema();
  const v = mapaVeredito(c)[veredito];

  /**
   * UMA ressalva por vez, e a mais grave primeiro: a pílula tem que caber ao lado
   * do preço, e "poucos dados · desatualizado" empilhado viraria um parágrafo que
   * ninguém lê. Base pequena vence porque ali o número pode ser a compra de uma
   * pessoa só — problema maior que ser antigo.
   */
  const ressalva = poucosDados ? 'poucos dados' : dadoVelho ? 'pode estar desatualizado' : null;
  const rotulo = ressalva ? `${v.rotulo} · ${ressalva}` : v.rotulo;

  return (
    <View
      style={[
        estilos.base,
        pequeno ? estilos.pequeno : estilos.grande,
        { backgroundColor: v.bg, borderColor: v.fg },
      ]}
    >
      <View style={[estilos.ponto, pequeno && estilos.pontoPequeno, { backgroundColor: v.fg }]} />
      <Texto peso="bold" tamanho={pequeno ? 'sm' : 'md'} style={{ color: v.fg }}>
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
    borderWidth: 1.5,
  },
  grande: { gap: espaco.sm, paddingVertical: 7, paddingHorizontal: espaco.md },
  pequeno: { gap: 5, paddingVertical: 3, paddingHorizontal: espaco.sm + 2 },
  ponto: { width: 8, height: 8, borderRadius: 4 },
  pontoPequeno: { width: 6, height: 6, borderRadius: 3 },
});
