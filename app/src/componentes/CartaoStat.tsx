/**
 * Redesign "2a" — cartão de estatística pequeno (número + legenda). Usado em par
 * no Início (ex.: produtos monitorados / mercados). Opcionalmente um tile de
 * ícone teal no topo.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { espaco, raio, useTema } from '@/tema';

import { Cartao } from './Cartao';
import { Texto } from './Texto';

export interface CartaoStatProps {
  numero: string;
  legenda: string;
  icone?: ReactNode;
}

export function CartaoStat({ numero, legenda, icone }: CartaoStatProps) {
  const { c } = useTema();
  return (
    <Cartao style={estilos.card}>
      {icone ? <View style={[estilos.tile, { backgroundColor: c.tealWash }]}>{icone}</View> : null}
      <Texto peso="extrabold" style={estilos.numero}>
        {numero}
      </Texto>
      <Texto peso="semibold" cor="suave" style={estilos.legenda}>
        {legenda}
      </Texto>
    </Cartao>
  );
}

const estilos = StyleSheet.create({
  card: { flex: 1, padding: espaco.lg },
  tile: {
    width: 34,
    height: 34,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: espaco.sm,
  },
  numero: { fontSize: 21 },
  legenda: { fontSize: 11.5, marginTop: 2 },
});
