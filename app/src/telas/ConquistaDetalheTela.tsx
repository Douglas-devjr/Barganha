/**
 * Handoff 3a (`conquistadet`) — detalhe de um selo: ícone grande, status
 * (desbloqueada/bloqueada), descrição, barra de progresso com o quanto falta e
 * a recompensa.
 *
 * Tudo derivado do MESMO `calcularContribuicao` das Conquistas — o selo chega
 * por `id`, e a tela recomputa sobre as datas de captura locais. Nada de tabela
 * nova nem número inventado (docs/12): a recompensa é status, não dinheiro.
 */

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type ReactElement, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  CabecalhoVoltar,
  Cartao,
  IconeCadeado,
  IconeCalendario,
  IconeChama,
  IconeCheck,
  IconeCoroa,
  IconePresente,
  IconeRecibo,
  IconeTrofeu,
  Tela,
  Texto,
  type IconeProps,
} from '@/componentes';
import { cupons } from '@/dados';
import { calcularContribuicao, type IconeSelo, type Selo } from '@/nucleo/gamificacao';
import type { RootStackParamList } from '@/navegacao/tipos';
import { espaco, raio, useTema } from '@/tema';

type Props = NativeStackScreenProps<RootStackParamList, 'ConquistaDetalhe'>;

const ICONES: Record<IconeSelo, (p: IconeProps) => ReactElement> = {
  check: IconeCheck,
  recibo: IconeRecibo,
  trofeu: IconeTrofeu,
  coroa: IconeCoroa,
  chama: IconeChama,
  calendario: IconeCalendario,
};

/** "Faltam 3 cupons" / "Falta 1 semana" — o texto sob a barra. */
function quantoFalta(selo: Selo): string {
  const resta = Math.max(0, selo.progresso.alvo - selo.progresso.atual);
  if (resta === 0) return 'Conquista desbloqueada!';
  const unidade =
    selo.id === 'ritmo' ? (resta === 1 ? 'semana' : 'semanas') : resta === 1 ? 'cupom' : 'cupons';
  return `Falta${resta === 1 ? '' : 'm'} ${resta} ${unidade}`;
}

export function ConquistaDetalheTela({ navigation, route }: Props) {
  const { id } = route.params;
  const { c } = useTema();
  const [selo, setSelo] = useState<Selo | null>(null);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      void cupons.listarDatasContribuicao().then((datas) => {
        if (!vivo) return;
        const encontrado = calcularContribuicao(datas).selos.find((s) => s.id === id) ?? null;
        setSelo(encontrado);
      });
      return () => {
        vivo = false;
      };
    }, [id]),
  );

  if (!selo) {
    return (
      <Tela>
        <CabecalhoVoltar titulo="Conquista" aoVoltar={() => navigation.goBack()} />
      </Tela>
    );
  }

  const Icone = ICONES[selo.icone];
  const conquistado = selo.conquistado;
  const pct = Math.min(1, selo.progresso.atual / selo.progresso.alvo);

  return (
    <Tela>
      <CabecalhoVoltar titulo="Conquista" aoVoltar={() => navigation.goBack()} />

      <Cartao style={estilos.cartaoTopo}>
        <View
          style={[
            estilos.icone,
            conquistado
              ? { backgroundColor: c.teal }
              : { borderWidth: 1.5, borderColor: c.borda, borderStyle: 'dashed' },
          ]}
        >
          <Icone tamanho={40} cor={conquistado ? c.sobreTeal : c.fraco} />
        </View>

        <Texto peso="bold" centralizado style={estilos.nome}>
          {selo.titulo}
        </Texto>

        <View style={[estilos.status, { backgroundColor: conquistado ? c.baratoBg : c.linha }]}>
          {!conquistado ? <IconeCadeado tamanho={11} cor={c.fraco} larguraTraco={2} /> : null}
          <Texto
            peso="bold"
            style={[estilos.statusTexto, { color: conquistado ? c.barato : c.suave }]}
          >
            {conquistado ? 'Desbloqueada' : 'Bloqueada'}
          </Texto>
        </View>

        <Texto cor="suave" tamanho="sm" centralizado style={estilos.descricao}>
          {selo.descricao}
        </Texto>
      </Cartao>

      <Cartao style={estilos.cartaoProgresso}>
        <View style={estilos.progressoTopo}>
          <Texto peso="semibold" tamanho="sm">
            Progresso
          </Texto>
          <Texto peso="bold" tamanho="sm" numerico>
            {Math.min(selo.progresso.atual, selo.progresso.alvo)}/{selo.progresso.alvo}
          </Texto>
        </View>
        <View style={[estilos.trilho, { backgroundColor: c.linha }]}>
          <View
            style={[
              estilos.preenchido,
              { backgroundColor: conquistado ? c.barato : c.tinta, width: `${pct * 100}%` },
            ]}
          />
        </View>
        <Texto cor="fraco" tamanho="xs" style={estilos.falta}>
          {quantoFalta(selo)}
        </Texto>
      </Cartao>

      <Cartao style={estilos.cartaoRecompensa}>
        <View style={[estilos.recompensaTile, { backgroundColor: c.linha }]}>
          <IconePresente tamanho={18} cor={c.tinta} larguraTraco={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Texto peso="semibold" tamanho="sm">
            Recompensa
          </Texto>
          <Texto cor="fraco" tamanho="xs" style={estilos.recompensaTexto}>
            {selo.recompensa}
          </Texto>
        </View>
      </Cartao>

      <Texto cor="fraco" tamanho="xs" centralizado style={estilos.nota}>
        As conquistas medem sua contribuição para a base colaborativa — status e estatística
        pessoal, sem valer dinheiro.
      </Texto>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  cartaoTopo: { alignItems: 'center', paddingVertical: espaco.xxl - 2 },
  icone: {
    width: 88,
    height: 88,
    borderRadius: raio.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nome: { fontSize: 22, letterSpacing: -0.6, marginTop: espaco.lg },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: raio.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: espaco.sm + 2,
  },
  statusTexto: { fontSize: 11 },
  descricao: { marginTop: espaco.md, lineHeight: 20 },
  cartaoProgresso: { marginTop: espaco.md },
  progressoTopo: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  trilho: { height: 8, borderRadius: raio.pill, marginTop: espaco.sm + 2, overflow: 'hidden' },
  preenchido: { height: '100%', borderRadius: raio.pill },
  falta: { marginTop: espaco.sm },
  cartaoRecompensa: {
    marginTop: espaco.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
  },
  recompensaTile: {
    width: 38,
    height: 38,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recompensaTexto: { marginTop: 1, lineHeight: 16 },
  nota: { marginTop: espaco.lg, lineHeight: 16 },
});
