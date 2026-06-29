/**
 * C8.1 — Início. Card de economia (descontos de promoção já registrados nos
 * cupons) + lista das Últimas compras. Tudo do histórico PRIVADO local (offline);
 * recarrega ao focar a aba para refletir cupons recém-processados.
 *
 * "Economia acumulada/tendência" mais rica é C8.3/C8.4 (Pós); aqui o número é o
 * desconto honesto da própria NFC-e, nunca uma estimativa.
 */

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Cartao, Tela, Texto } from '@/componentes';
import { cupons } from '@/dados';
import type { CompraResumo, ResumoCompras } from '@/dados/repositorio-cupom';
import { dataCurta, moeda } from '@/nucleo/formato';
import { cores, espaco } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Navegacao = NativeStackNavigationProp<RootStackParamList>;

const RESUMO_VAZIO: ResumoCompras = {
  totalCupons: 0,
  totalItens: 0,
  gastoTotal: 0,
  economiaTotal: 0,
};

export function InicioTela() {
  const navigation = useNavigation<Navegacao>();
  const [resumo, setResumo] = useState<ResumoCompras>(RESUMO_VAZIO);
  const [recentes, setRecentes] = useState<CompraResumo[]>([]);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      void (async () => {
        const [r, c] = await Promise.all([cupons.resumoCompras(), cupons.listarComprasRecentes(6)]);
        if (!ativo) return;
        setResumo(r);
        setRecentes(c);
      })();
      return () => {
        ativo = false;
      };
    }, []),
  );

  return (
    <Tela titulo="Olá 👋">
      <CardEconomia resumo={resumo} />

      <Texto peso="extrabold" tamanho="lg" style={{ marginBottom: espaco.sm }}>
        Últimas compras
      </Texto>

      {recentes.length === 0 ? (
        <Cartao>
          <View style={estilos.vazio}>
            <Texto cor="textoMudo" centralizado>
              Nenhuma compra ainda. Toque no botão central para escanear seu primeiro cupom.
            </Texto>
          </View>
        </Cartao>
      ) : (
        <Cartao semPadding>
          {recentes.map((compra, idx) => (
            <CompraLinha
              key={compra.cupomLocalId}
              compra={compra}
              ultima={idx === recentes.length - 1}
              aoAbrir={() =>
                navigation.navigate('NotaFiscal', { cupomLocalId: compra.cupomLocalId })
              }
            />
          ))}
        </Cartao>
      )}
    </Tela>
  );
}

function CardEconomia({ resumo }: { resumo: ResumoCompras }) {
  const temCompras = resumo.totalCupons > 0;
  const temEconomia = resumo.economiaTotal > 0;

  const legenda = !temCompras
    ? 'Comece escaneando um cupom para acompanhar suas compras e promoções.'
    : temEconomia
      ? `Em descontos de promoção nos seus ${resumo.totalCupons} ${
          resumo.totalCupons === 1 ? 'cupom' : 'cupons'
        }.`
      : 'Ainda não vimos promoções nos seus cupons — elas aparecem aqui quando a nota traz desconto.';

  return (
    <Cartao style={{ backgroundColor: cores.marca, marginBottom: espaco.lg }}>
      <Texto cor="marcaBgClaro" tamanho="sm" peso="semibold">
        Economia em promoções
      </Texto>
      <Texto cor="branco" tamanho="display" peso="extrabold" style={{ marginTop: espaco.xs }}>
        {moeda(resumo.economiaTotal)}
      </Texto>
      <Texto cor="marcaBgClaro" tamanho="sm" style={{ marginTop: espaco.xs }}>
        {legenda}
      </Texto>
    </Cartao>
  );
}

function rotuloStatus(compra: CompraResumo): string {
  switch (compra.status) {
    case 'processado':
      return `${compra.totalItens} ${compra.totalItens === 1 ? 'item' : 'itens'}`;
    case 'falha':
      return 'Não foi possível ler';
    default:
      return 'Processando…';
  }
}

function CompraLinha({
  compra,
  ultima,
  aoAbrir,
}: {
  compra: CompraResumo;
  ultima: boolean;
  aoAbrir: () => void;
}) {
  const processado = compra.status === 'processado';
  const data = dataCurta(compra.observadoEm);
  const titulo = compra.lojaNome ?? (processado ? 'Mercado' : 'Cupom escaneado');
  const detalhe = [data, rotuloStatus(compra)].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={aoAbrir}
      accessibilityRole="button"
      style={({ pressed }) => [
        estilos.linha,
        !ultima && estilos.linhaBorda,
        pressed && estilos.linhaPressionada,
      ]}
    >
      <View style={estilos.linhaTexto}>
        <Texto peso="semibold" numberOfLines={1}>
          {titulo}
        </Texto>
        <Texto cor="textoMudo" tamanho="sm" style={{ marginTop: 2 }}>
          {detalhe}
          {compra.economia > 0 ? `  · economizou ${moeda(compra.economia)}` : ''}
        </Texto>
      </View>
      {processado ? <Texto peso="bold">{moeda(compra.valorTotal)}</Texto> : null}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  vazio: { alignItems: 'center', paddingVertical: espaco.lg },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
  linhaBorda: { borderBottomWidth: 1, borderBottomColor: cores.borda },
  linhaTexto: { flex: 1 },
  linhaPressionada: { opacity: 0.6 },
});
