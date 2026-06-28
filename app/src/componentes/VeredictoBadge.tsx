/**
 * C5.2 — Pílula de veredito (barato / na média / caro / sem dados). Usa o tipo
 * `Veredito` de @barganha/shared — a MESMA classificação do backend, resolvida
 * localmente (docs/06). A promoção nunca entra aqui; vai numa linha à parte.
 */

import type { Veredito } from '@barganha/shared';
import { StyleSheet, View } from 'react-native';

import { coresVeredito, espaco, raio } from '@/tema';

import { Texto } from './Texto';

export interface VeredictoBadgeProps {
  veredito: Veredito;
  /** Sinaliza base pequena demais para confiar (ressalva de "poucos dados"). */
  poucosDados?: boolean;
}

export function VeredictoBadge({ veredito, poucosDados = false }: VeredictoBadgeProps) {
  const v = coresVeredito[veredito];
  const rotulo = poucosDados ? `${v.rotulo} · poucos dados` : v.rotulo;

  return (
    <View style={[estilos.base, { backgroundColor: v.bg }]}>
      <View style={[estilos.ponto, { backgroundColor: v.fg }]} />
      <Texto peso="bold" tamanho="sm" style={{ color: v.fg }}>
        {rotulo}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.xs + 2,
    alignSelf: 'flex-start',
    paddingVertical: espaco.xs + 2,
    paddingHorizontal: espaco.md,
    borderRadius: raio.pill,
  },
  ponto: { width: 8, height: 8, borderRadius: 4 },
});
