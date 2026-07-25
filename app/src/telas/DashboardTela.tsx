/**
 * Redesign "3a" — Resumo de descontos. Segmentado dos últimos meses + gráfico de
 * barras (o mês ativo na tinta, os demais em `linha`) + "de onde vieram".
 *
 * O número é o desconto HONESTO da própria NFC-e (`desconto_total` do cupom, ou
 * a soma dos descontos por item), nunca estimativa — mesma regra do card do
 * Início, e pelo mesmo motivo NÃO se chama economia: é a promoção que o mercado
 * deu, não o resultado de escolher bem (docs/06 §"Economia real").
 * Mês sem cupom processado simplesmente não aparece.
 *
 * O handoff agrupa "onde economizou" por categoria; como categoria não desce ao
 * catálogo local (C11.5 vive no backend), agrupamos por PRODUTO — ver
 * `cupons.economiaPorProduto`.
 */

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CabecalhoVoltar, Cartao, Estado, IconeRecibo, Tela, Texto } from '@/componentes';
import { cupons } from '@/dados';
import type { EconomiaMensal, EconomiaPorProduto } from '@/dados/repositorio-cupom';
import { moeda } from '@/nucleo/formato';
import { espaco, raio, tabular, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

const MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** "2026-07" → "jul". */
function rotuloCurto(mes: string): string {
  const idx = Number(mes.split('-')[1]) - 1;
  return MESES_CURTOS[idx] ?? mes;
}

export function DashboardTela({ navigation }: Props) {
  const { c } = useTema();
  const [meses, setMeses] = useState<EconomiaMensal[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [porProduto, setPorProduto] = useState<EconomiaPorProduto[]>([]);
  const [carregado, setCarregado] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      void cupons.economiaPorMes(6).then((lista) => {
        if (!ativo) return;
        // `economiaPorMes` vem do mais recente para o mais antigo; o gráfico lê
        // da esquerda (antigo) para a direita (recente).
        setMeses([...lista].reverse());
        setSelecionado((atual) => atual ?? lista[0]?.mes ?? null);
        setCarregado(true);
      });
      return () => {
        ativo = false;
      };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      if (!selecionado) return;
      let ativo = true;
      void cupons.economiaPorProduto(4, selecionado).then((l) => {
        if (ativo) setPorProduto(l);
      });
      return () => {
        ativo = false;
      };
    }, [selecionado]),
  );

  const doMes = meses.find((m) => m.mes === selecionado);
  const maiorBarra = Math.max(...meses.map((m) => m.economia), 0.01);
  const maiorProduto = Math.max(...porProduto.map((p) => p.economia), 0.01);

  if (carregado && meses.length === 0) {
    return (
      <Tela>
        <CabecalhoVoltar titulo="Resumo de descontos" aoVoltar={() => navigation.goBack()} />
        <Estado
          icone={<IconeRecibo tamanho={30} cor={c.tinta} />}
          titulo="Ainda sem desconto registrado"
          texto={
            'Escaneie cupons com desconto para acompanhar quanto o mercado te deu por mês. O ' +
            'valor vem do próprio cupom — nunca de estimativa.'
          }
        />
      </Tela>
    );
  }

  return (
    <Tela>
      <CabecalhoVoltar titulo="Resumo de descontos" aoVoltar={() => navigation.goBack()} />

      {/* segmentado dos meses disponíveis */}
      <View style={estilos.segmentado}>
        {meses.map((m) => {
          const ativo = m.mes === selecionado;
          return (
            <Pressable
              key={m.mes}
              onPress={() => setSelecionado(m.mes)}
              accessibilityRole="button"
              accessibilityState={ativo ? { selected: true } : {}}
              style={[
                estilos.segmento,
                {
                  backgroundColor: ativo ? c.tinta : c.cartao,
                  borderColor: ativo ? c.tinta : c.borda,
                },
              ]}
            >
              <Texto
                tamanho="sm"
                peso={ativo ? 'bold' : 'semibold'}
                cor={ativo ? 'sobreTeal' : 'suave'}
              >
                {rotuloCurto(m.mes)}
              </Texto>
            </Pressable>
          );
        })}
      </View>

      <Cartao>
        <Texto peso="semibold" cor="fraco" style={estilos.eyebrow}>
          DESCONTOS NO MÊS
        </Texto>
        <Texto peso="bold" numerico style={estilos.valorGigante}>
          {moeda(doMes?.economia ?? 0)}
        </Texto>

        {/* gráfico de barras: o mês ativo na tinta, os outros em `linha` */}
        <View style={estilos.grafico}>
          {meses.map((m) => {
            const ativo = m.mes === selecionado;
            const altura = Math.max(4, (m.economia / maiorBarra) * 96);
            return (
              <Pressable
                key={m.mes}
                onPress={() => setSelecionado(m.mes)}
                accessibilityRole="button"
                accessibilityLabel={`${rotuloCurto(m.mes)}: ${moeda(m.economia)}`}
                style={estilos.coluna}
              >
                <View
                  style={[
                    estilos.barra,
                    { height: altura, backgroundColor: ativo ? c.tinta : c.linha },
                  ]}
                />
                <Texto
                  tamanho="xs"
                  peso={ativo ? 'bold' : 'medium'}
                  cor={ativo ? 'tinta' : 'fraco'}
                  style={{ marginTop: espaco.sm }}
                >
                  {rotuloCurto(m.mes)}
                </Texto>
              </Pressable>
            );
          })}
        </View>
      </Cartao>

      <Texto peso="bold" tamanho="lg" style={estilos.secao}>
        De onde vieram os descontos
      </Texto>

      {porProduto.length === 0 ? (
        <Cartao>
          <Texto cor="suave" tamanho="sm">
            Nenhum item com desconto neste mês.
          </Texto>
        </Cartao>
      ) : (
        <Cartao>
          {porProduto.map((p, idx) => (
            <View key={p.nome} style={idx > 0 ? { marginTop: espaco.lg } : undefined}>
              <View style={estilos.produtoLinha}>
                <Texto peso="semibold" tamanho="sm" numberOfLines={1} style={{ flex: 1 }}>
                  {p.nome}
                </Texto>
                <Texto peso="bold" tamanho="sm" numerico cor="barato">
                  {moeda(p.economia)}
                </Texto>
              </View>
              <View style={[estilos.trilho, { backgroundColor: c.linha }]}>
                <View
                  style={[
                    estilos.preenchido,
                    { backgroundColor: c.tinta, width: `${(p.economia / maiorProduto) * 100}%` },
                  ]}
                />
              </View>
            </View>
          ))}
        </Cartao>
      )}

      <Texto cor="fraco" tamanho="xs" centralizado style={estilos.nota}>
        Valor do desconto registrado no próprio cupom fiscal. Não é estimativa.
      </Texto>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  segmentado: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm, marginBottom: espaco.lg },
  segmento: {
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.sm,
    borderRadius: raio.pill,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  eyebrow: { fontSize: 11, letterSpacing: 1.3 },
  valorGigante: { fontSize: 40, letterSpacing: -2, marginTop: espaco.xs, ...tabular },
  grafico: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: espaco.xl,
    minHeight: 120,
  },
  coluna: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barra: { width: 22, borderRadius: raio.sm },
  secao: { marginTop: espaco.xl, marginBottom: espaco.md, letterSpacing: -0.3 },
  produtoLinha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  trilho: { height: 6, borderRadius: raio.pill, marginTop: espaco.sm, overflow: 'hidden' },
  preenchido: { height: '100%', borderRadius: raio.pill },
  nota: { marginTop: espaco.lg, lineHeight: 16 },
});
