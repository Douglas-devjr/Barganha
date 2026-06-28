/**
 * C5.1 — Verificar (esqueleto). O scan de barras + veredito do cache (offline) e
 * o refino online são C7.1/C7.2. Aqui mostramos a moldura e uma amostra do
 * componente de veredito do design system.
 */

import { View } from 'react-native';

import { Botao, Cartao, IconeBusca, Tela, Texto, VeredictoBadge } from '@/componentes';
import { cores, espaco, raio } from '@/tema';

export function VerificarTela() {
  return (
    <Tela titulo="Verificar">
      <Cartao style={{ marginBottom: espaco.lg }}>
        <Texto cor="textoMudo" tamanho="sm" peso="semibold" style={{ marginBottom: espaco.sm }}>
          Na gôndola
        </Texto>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: espaco.sm,
            backgroundColor: cores.superficieMuda,
            borderRadius: raio.md,
            paddingHorizontal: espaco.md,
            paddingVertical: espaco.md,
            marginBottom: espaco.md,
          }}
        >
          <IconeBusca tamanho={18} cor={cores.placeholder} />
          <Texto cor="placeholder">Buscar produto por nome…</Texto>
        </View>
        <Botao titulo="Escanear código de barras" />
      </Cartao>

      <Texto cor="textoMudo" tamanho="sm" style={{ marginBottom: espaco.sm }}>
        Exemplos de veredito (design system):
      </Texto>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm }}>
        <VeredictoBadge veredito="barato" />
        <VeredictoBadge veredito="na_media" />
        <VeredictoBadge veredito="caro" />
        <VeredictoBadge veredito="sem_dados" />
      </View>
    </Tela>
  );
}
