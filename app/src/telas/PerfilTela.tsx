/**
 * C5.1 — Perfil (esqueleto). Dados mínimos, mercados favoritos e preferências
 * são C8.2. Aqui ficam a moldura e a nota de conta anônima (C4.3 / docs/04).
 */

import { View } from 'react-native';

import { Cartao, Tela, Texto } from '@/componentes';
import { espaco } from '@/tema';

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: espaco.md,
      }}
    >
      <Texto cor="textoSuave">{rotulo}</Texto>
      <Texto peso="bold">{valor}</Texto>
    </View>
  );
}

export function PerfilTela() {
  return (
    <Tela titulo="Perfil">
      <Cartao semPadding style={{ paddingHorizontal: espaco.lg }}>
        <Linha rotulo="Conta" valor="Anônima" />
        <Linha rotulo="Município" valor="—" />
        <Linha rotulo="Cupons escaneados" valor="0" />
      </Cartao>

      <Texto cor="textoMudo" tamanho="sm" centralizado style={{ marginTop: espaco.lg }}>
        Sua conta é anônima: não guardamos nome nem CPF. Os preços que você compartilha entram
        soltos, sem ligação com você (LGPD).
      </Texto>
    </Tela>
  );
}
