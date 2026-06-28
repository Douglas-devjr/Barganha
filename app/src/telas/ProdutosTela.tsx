/**
 * C5.1 — Produtos (esqueleto). A lista real e o detalhe com gráfico de 6 meses
 * são C7.4/C7.5. Aqui ficam a busca e o estado vazio.
 */

import { View } from 'react-native';

import { Cartao, IconeBusca, Tela, Texto } from '@/componentes';
import { cores, espaco, raio } from '@/tema';

export function ProdutosTela() {
  return (
    <Tela titulo="Meus produtos">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: espaco.sm,
          backgroundColor: cores.superficie,
          borderColor: cores.superficieMuda,
          borderWidth: 1,
          borderRadius: raio.md,
          paddingHorizontal: espaco.md,
          paddingVertical: espaco.md,
          marginBottom: espaco.lg,
        }}
      >
        <IconeBusca tamanho={18} cor={cores.placeholder} />
        <Texto cor="placeholder">Buscar produto…</Texto>
      </View>

      <Cartao>
        <View style={{ alignItems: 'center', paddingVertical: espaco.lg }}>
          <Texto cor="textoMudo" centralizado>
            Seus produtos aparecem aqui conforme você escaneia cupons.
          </Texto>
        </View>
      </Cartao>
    </Tela>
  );
}
