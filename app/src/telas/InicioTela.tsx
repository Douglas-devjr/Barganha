/**
 * C5.1 — Início (esqueleto). A versão com card de economia + últimas compras é
 * C8.1; aqui fica a moldura com o design system e os estados vazios.
 */

import { View } from 'react-native';

import { Cartao, Tela, Texto } from '@/componentes';
import { cores, espaco } from '@/tema';

export function InicioTela() {
  return (
    <Tela titulo="Olá 👋">
      <Cartao style={{ backgroundColor: cores.marca, marginBottom: espaco.lg }}>
        <Texto cor="marcaBgClaro" tamanho="sm" peso="semibold">
          Economia acumulada
        </Texto>
        <Texto cor="branco" tamanho="display" peso="extrabold" style={{ marginTop: espaco.xs }}>
          R$ 0,00
        </Texto>
        <Texto cor="marcaBgClaro" tamanho="sm" style={{ marginTop: espaco.xs }}>
          Comece escaneando um cupom para ver quanto você economiza.
        </Texto>
      </Cartao>

      <Texto peso="extrabold" tamanho="lg" style={{ marginBottom: espaco.sm }}>
        Últimas compras
      </Texto>
      <Cartao>
        <View style={{ alignItems: 'center', paddingVertical: espaco.lg }}>
          <Texto cor="textoMudo" centralizado>
            Nenhuma compra ainda. Toque no botão central para escanear seu primeiro cupom.
          </Texto>
        </View>
      </Cartao>
    </Tela>
  );
}
