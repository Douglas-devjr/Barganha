/**
 * Redesign "3a" + C12.2 — Conquistas e prêmios. Cartão de nível (progresso de
 * selos) + grade 2×N de badges: conquistados em círculo de tinta, bloqueados
 * tracejados e esmaecidos.
 *
 * Tudo sai de `nucleo/gamificacao.calcularContribuicao()` sobre as datas dos
 * cupons PROCESSADOS por completo — nenhuma tabela nova, nenhum número
 * inventado. Cupom ainda em processamento não conta (não virou preço na base);
 * a tela diz quantos são, para o número não parecer errado ao lado dos
 * "escaneados" do Perfil. A recompensa é status e estatística pessoal; não há
 * cashback (docs/12).
 */

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type ReactElement, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Pressable } from 'react-native';

import {
  CabecalhoVoltar,
  Cartao,
  IconeCadeado,
  IconeCalendario,
  IconeChama,
  IconeCheck,
  IconeCoroa,
  IconeRecibo,
  IconeTrofeu,
  Tela,
  Texto,
  type IconeProps,
} from '@/componentes';
import { cupons } from '@/dados';
import {
  calcularContribuicao,
  type Contribuicao,
  type IconeSelo,
  type Selo,
} from '@/nucleo/gamificacao';
import { espaco, raio, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'Conquistas'>;

const VAZIO: Contribuicao = calcularContribuicao([]);

/** Nível = quantos selos já caíram (rótulo puramente derivado, sem tabela). */
function nivelDe(conquistados: number): string {
  if (conquistados >= 6) return 'LENDA DO MERCADO';
  if (conquistados >= 4) return 'CAÇADOR DE OFERTAS';
  if (conquistados >= 2) return 'EXPLORADOR DE PREÇOS';
  return 'PRIMEIROS PASSOS';
}

export function ConquistasTela({ navigation }: Props) {
  const { c } = useTema();
  const [dados, setDados] = useState<Contribuicao>(VAZIO);
  const [emProcessamento, setEmProcessamento] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      void Promise.all([cupons.listarDatasContribuicao(), cupons.contarEmProcessamento()]).then(
        ([datas, pendentes]) => {
          if (!ativo) return;
          setDados(calcularContribuicao(datas));
          setEmProcessamento(pendentes);
        },
      );
      return () => {
        ativo = false;
      };
    }, []),
  );

  const conquistados = dados.selos.filter((s) => s.conquistado).length;
  const total = dados.selos.length;
  const pct = total > 0 ? conquistados / total : 0;
  const proximo = dados.selos.find((s) => !s.conquistado);

  return (
    <Tela>
      <CabecalhoVoltar titulo="Conquistas" aoVoltar={() => navigation.goBack()} />

      <Cartao>
        <Texto peso="semibold" cor="fraco" style={estilos.eyebrow}>
          NÍVEL {Math.max(1, conquistados)} · {nivelDe(conquistados)}
        </Texto>

        <View style={estilos.progressoLinha}>
          <Texto peso="bold" tamanho="xl" numerico>
            {conquistados}/{total}
          </Texto>
          <Texto cor="suave" tamanho="sm">
            conquistas
          </Texto>
        </View>

        <View style={[estilos.trilho, { backgroundColor: c.linha }]}>
          <View
            style={[estilos.preenchido, { backgroundColor: c.tinta, width: `${pct * 100}%` }]}
          />
        </View>

        <Texto cor="suave" tamanho="sm" style={{ marginTop: espaco.md }}>
          {proximo
            ? `Próxima: ${proximo.titulo} — ${proximo.descricao.toLowerCase()}.`
            : 'Você desbloqueou todas as conquistas. Obrigado por alimentar a base!'}
        </Texto>
      </Cartao>

      <View style={estilos.resumo}>
        <Texto cor="suave" tamanho="sm">
          {dados.totalCupons === 1
            ? '1 cupom processado'
            : `${dados.totalCupons} cupons processados`}
          {dados.sequenciaSemanas > 0
            ? ` · ${dados.sequenciaSemanas} ${dados.sequenciaSemanas === 1 ? 'semana seguida' : 'semanas seguidas'}`
            : ''}
        </Texto>
        {emProcessamento > 0 ? (
          <Texto cor="fraco" tamanho="xs" style={estilos.pendentes}>
            {emProcessamento === 1
              ? '1 cupom ainda em processamento — conta quando terminar.'
              : `${emProcessamento} cupons ainda em processamento — contam quando terminarem.`}
          </Texto>
        ) : null}
      </View>

      <View style={estilos.grade}>
        {dados.selos.map((selo) => (
          <Badge
            key={selo.id}
            selo={selo}
            aoTocar={() => navigation.navigate('ConquistaDetalhe', { id: selo.id })}
          />
        ))}
      </View>

      <Texto cor="fraco" tamanho="xs" centralizado style={estilos.nota}>
        Cada cupom processado vira preço anônimo na base da sua região. As conquistas medem sua
        contribuição — não valem dinheiro.
      </Texto>
    </Tela>
  );
}

/** Cada conquista tem seu ícone (handoff 3a): o mapa mora aqui, na camada de UI. */
const ICONES: Record<IconeSelo, (p: IconeProps) => ReactElement> = {
  check: IconeCheck,
  recibo: IconeRecibo,
  trofeu: IconeTrofeu,
  coroa: IconeCoroa,
  chama: IconeChama,
  calendario: IconeCalendario,
};

function Badge({ selo, aoTocar }: { selo: Selo; aoTocar: () => void }) {
  const { c } = useTema();
  const conquistado = selo.conquistado;
  const Icone = ICONES[selo.icone];

  return (
    <Pressable
      onPress={aoTocar}
      accessibilityRole="button"
      accessibilityLabel={`${selo.titulo}, ${conquistado ? 'desbloqueada' : 'bloqueada'}`}
      style={({ pressed }) => [
        estilos.badge,
        !conquistado && estilos.badgeBloqueado,
        pressed && { opacity: 0.6 },
      ]}
    >
      <View
        style={[
          estilos.circulo,
          conquistado
            ? { backgroundColor: c.tinta }
            : { borderWidth: 1.5, borderColor: c.borda, borderStyle: 'dashed' },
        ]}
      >
        <Icone tamanho={22} cor={conquistado ? c.sobreTeal : c.fraco} />
      </View>
      <Texto peso="semibold" tamanho="sm" centralizado style={{ marginTop: espaco.sm }}>
        {selo.titulo}
      </Texto>
      <View style={estilos.descricao}>
        {/* 3a é só SVG stroke — o cadeado do bloqueado era emoji. */}
        {!conquistado ? <IconeCadeado tamanho={11} cor={c.fraco} larguraTraco={2} /> : null}
        <Texto cor="fraco" tamanho="xs" centralizado style={{ flexShrink: 1 }}>
          {selo.descricao}
        </Texto>
      </View>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  eyebrow: { fontSize: 11, letterSpacing: 1.3 },
  progressoLinha: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: espaco.sm,
    marginTop: espaco.sm,
  },
  trilho: { height: 6, borderRadius: raio.pill, marginTop: espaco.md, overflow: 'hidden' },
  preenchido: { height: '100%', borderRadius: raio.pill },
  resumo: { marginTop: espaco.md, marginBottom: espaco.lg },
  pendentes: { marginTop: espaco.xs },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.md },
  badge: {
    // 2 colunas: metade da largura menos o gap.
    width: '47.5%',
    alignItems: 'center',
    paddingVertical: espaco.lg,
  },
  badgeBloqueado: { opacity: 0.55 },
  descricao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 2,
  },
  circulo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nota: { marginTop: espaco.lg, lineHeight: 16 },
});
