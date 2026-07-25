/**
 * Redesign "3a" — painel de tela cheia com uma decisão só: ícone grande
 * centralizado, título, texto de apoio e as ações presas no rodapé.
 *
 * É a forma que o handoff repete nas telas de priming de permissão
 * (`permcam`/`permloc`), no estado de "sem conexão" (`offline`) e no erro de
 * leitura (`erro`). Fica aqui para as três não recopiarem medida.
 *
 * O tile do ícone tem dois tons: `tinta` quando a tela CONVIDA a fazer algo
 * (priming) e `apagado` quando ela relata um bloqueio (permissão negada, sem
 * rede) — o mesmo par `chip`/`line2` do protótipo.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { espaco, raio, useTema } from '@/tema';

import { Botao } from './Botao';
import { Texto } from './Texto';

export interface AcaoPainel {
  titulo: string;
  onPress: () => void;
  carregando?: boolean;
}

export interface PainelFocoProps {
  /** Ícone já dimensionado; a cor certa vem de `corIcone` no render da tela. */
  icone: ReactNode;
  titulo: string;
  texto: string;
  /** `tinta` = convite (priming); `apagado` = bloqueio/erro. */
  tom?: 'tinta' | 'apagado';
  /** Tile redondo (76px) em vez do quadrado 100px — usado pelos estados de erro. */
  redondo?: boolean;
  acao: AcaoPainel;
  acaoSecundaria?: AcaoPainel;
  /** Nota fina abaixo das ações (ex.: "seus cupons ficam salvos"). */
  rodape?: string;
}

export function PainelFoco({
  icone,
  titulo,
  texto,
  tom = 'tinta',
  redondo = false,
  acao,
  acaoSecundaria,
  rodape,
}: PainelFocoProps) {
  const { c } = useTema();

  return (
    <SafeAreaView style={[estilos.raiz, { backgroundColor: c.fundo }]} edges={['top', 'bottom']}>
      <View style={estilos.centro}>
        <View
          style={[
            redondo ? estilos.tileRedondo : estilos.tile,
            { backgroundColor: tom === 'tinta' ? c.teal : c.linha },
          ]}
        >
          {icone}
        </View>

        <Texto peso="bold" centralizado style={estilos.titulo}>
          {titulo}
        </Texto>
        <Texto cor="suave" centralizado style={estilos.texto}>
          {texto}
        </Texto>
      </View>

      <View style={estilos.acoes}>
        <Botao
          titulo={acao.titulo}
          bloco
          carregando={acao.carregando ?? false}
          onPress={acao.onPress}
        />
        {acaoSecundaria ? (
          <Botao
            titulo={acaoSecundaria.titulo}
            variante="fantasma"
            bloco
            onPress={acaoSecundaria.onPress}
          />
        ) : null}
        {rodape ? (
          <Texto cor="fraco" tamanho="xs" centralizado style={estilos.rodape}>
            {rodape}
          </Texto>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

/**
 * Cor do ícone que casa com o `tom` do painel — a tela passa isso ao SVG.
 * Sobre a tinta o ícone INVERTE (`sobreTeal`); sobre o tile apagado ele fica
 * em `fraco`. Regra travada do 3a: nunca branco fixo.
 */
export function corIconePainel(
  c: { sobreTeal: string; fraco: string },
  tom: 'tinta' | 'apagado',
): string {
  return tom === 'tinta' ? c.sobreTeal : c.fraco;
}

const estilos = StyleSheet.create({
  raiz: { flex: 1 },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xxl + 8,
  },
  tile: {
    width: 100,
    height: 100,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileRedondo: {
    width: 84,
    height: 84,
    borderRadius: raio.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titulo: { fontSize: 24, letterSpacing: -0.6, marginTop: espaco.xxl - 2 },
  texto: { fontSize: 14, lineHeight: 22, marginTop: espaco.sm + 2 },
  acoes: { paddingHorizontal: espaco.xxl, paddingBottom: espaco.xl, gap: espaco.sm },
  rodape: { marginTop: espaco.sm, lineHeight: 17 },
});
