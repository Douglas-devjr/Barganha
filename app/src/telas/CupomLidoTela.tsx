/**
 * Handoff 3a (`sucesso`) — a confirmação que fecha o fluxo de escaneamento:
 * check grande, resumo do cupom (loja, total, economia) e a contagem de itens
 * baratos / na média / caros da compra.
 *
 * Quem empurra esta tela é a NotaFiscal, na PRIMEIRA vez que um cupom recém
 * escaneado vira `processado` — o parsing é assíncrono (roda no backend), então
 * o "sucesso" só pode existir quando a nota volta. "Ver detalhes do cupom" é um
 * `goBack`: a NotaFiscal já está embaixo, com a lista completa.
 *
 * A contagem sai do MESMO motor do resto do app (`resolverVeredito` sobre o
 * cache regional): item sem base na região não entra em nenhuma coluna, em vez
 * de ser chutado para "na média".
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Botao, Cartao, Eyebrow, IconeCheck, Texto } from '@/componentes';
import { cupons } from '@/dados';
import type { CupomLocal, ItemCupomLocal } from '@/dados';
import type { RootStackParamList } from '@/navegacao/tipos';
import { moeda } from '@/nucleo/formato';
import { resolverVeredito } from '@/nucleo/veredito-local';
import { espaco, raio, tabular, useTema } from '@/tema';

type Props = NativeStackScreenProps<RootStackParamList, 'CupomLido'>;

interface Contagem {
  barato: number;
  naMedia: number;
  caro: number;
}

const ZERO: Contagem = { barato: 0, naMedia: 0, caro: 0 };

/** "GUANABARA · HOJE 10:42" — o eyebrow do card no handoff. */
function cabecalhoDe(cupom: CupomLocal | null): string {
  if (!cupom) return 'CUPOM';
  const loja = cupom.lojaNome?.toUpperCase() ?? 'CUPOM';
  const d = new Date(cupom.emitidoEm ?? cupom.capturadoEm);
  if (Number.isNaN(d.getTime())) return loja;

  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje = new Date();
  const quando = d.toDateString() === hoje.toDateString() ? 'HOJE' : d.toLocaleDateString('pt-BR');
  return `${loja} · ${quando} ${hora}`;
}

export function CupomLidoTela({ navigation, route }: Props) {
  const { c } = useTema();
  const { cupomLocalId } = route.params;

  const [cupom, setCupom] = useState<CupomLocal | null>(null);
  const [itens, setItens] = useState<ItemCupomLocal[]>([]);
  const [contagem, setContagem] = useState<Contagem>(ZERO);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [cc, is] = await Promise.all([
        cupons.obterCupom(cupomLocalId),
        cupons.listarItens(cupomLocalId),
      ]);
      if (!vivo) return;
      setCupom(cc);
      setItens(is);

      const vereditos = await Promise.all(
        is.map(async (item) => {
          if (!item.produtoCanonicoId) return null;
          const r = await resolverVeredito({
            precoPrateleira: item.valorUnitario,
            produtoCanonicoId: item.produtoCanonicoId,
            unidadeVenda: item.unidade,
          });
          // Sem ângulo regional não há com o que comparar — fora da contagem.
          if (r.semDados || !r.hibrido.regional) return null;
          return r.hibrido.veredito;
        }),
      );
      if (!vivo) return;

      setContagem(
        vereditos.reduce<Contagem>(
          (acc, v) =>
            v === 'barato'
              ? { ...acc, barato: acc.barato + 1 }
              : v === 'caro'
                ? { ...acc, caro: acc.caro + 1 }
                : v === 'na_media'
                  ? { ...acc, naMedia: acc.naMedia + 1 }
                  : acc,
          ZERO,
        ),
      );
    })();
    return () => {
      vivo = false;
    };
  }, [cupomLocalId]);

  const total = cupom?.valorPago ?? itens.reduce((s, i) => s + i.valorTotal, 0);
  const economia = cupom?.descontoTotal ?? 0;
  const nItens = itens.length;

  return (
    <SafeAreaView style={[estilos.raiz, { backgroundColor: c.fundo }]} edges={['top', 'bottom']}>
      <View style={estilos.centro}>
        <View style={[estilos.selo, { backgroundColor: c.teal }]}>
          <IconeCheck tamanho={42} cor={c.sobreTeal} larguraTraco={2.4} />
        </View>

        <Texto peso="bold" centralizado style={estilos.titulo}>
          Cupom lido com sucesso!
        </Texto>
        <Texto cor="suave" centralizado style={estilos.apoio}>
          {nItens > 0
            ? `${nItens} ${nItens === 1 ? 'item entrou' : 'itens entraram'} no seu histórico e já ` +
              'estão comparados com a sua região.'
            : 'A compra entrou no seu histórico.'}
        </Texto>

        <Cartao style={estilos.cartao}>
          <Eyebrow>{cabecalhoDe(cupom)}</Eyebrow>

          <View style={estilos.totalLinha}>
            <Texto peso="bold" numerico style={estilos.total}>
              {moeda(total)}
            </Texto>
            {economia > 0 ? (
              <View style={[estilos.pilulaEconomia, { borderColor: c.barato }]}>
                <Texto peso="bold" numerico style={[estilos.economiaTexto, { color: c.barato }]}>
                  −{moeda(economia)}
                </Texto>
              </View>
            ) : null}
          </View>

          <View style={[estilos.contagens, { borderTopColor: c.linha }]}>
            <Coluna valor={contagem.barato} rotulo="baratos" cor={c.barato} />
            <Coluna valor={contagem.naMedia} rotulo="na média" cor={c.medio} />
            <Coluna valor={contagem.caro} rotulo="caros" cor={c.caro} />
          </View>

          {contagem.barato + contagem.naMedia + contagem.caro === 0 && nItens > 0 ? (
            <Texto cor="fraco" tamanho="xs" style={estilos.semBase}>
              Ainda não há preços suficientes da sua região para comparar estes itens. Cada cupom
              escaneado ajuda a preencher.
            </Texto>
          ) : null}
        </Cartao>
      </View>

      <View style={estilos.acoes}>
        <Botao titulo="Ver detalhes do cupom" bloco onPress={() => navigation.goBack()} />
        <Botao
          titulo="Voltar ao início"
          variante="secundario"
          bloco
          onPress={() => navigation.popToTop()}
        />
      </View>
    </SafeAreaView>
  );
}

function Coluna({ valor, rotulo, cor }: { valor: number; rotulo: string; cor: string }) {
  return (
    <View style={estilos.coluna}>
      <Texto peso="bold" numerico style={[estilos.colunaValor, { color: cor }]}>
        {valor}
      </Texto>
      <Texto cor="fraco" style={estilos.colunaRotulo}>
        {rotulo}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1 },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco.xxl,
  },
  selo: {
    width: 84,
    height: 84,
    borderRadius: raio.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titulo: { fontSize: 24, letterSpacing: -0.8, marginTop: espaco.xl - 2 },
  apoio: { fontSize: 13.5, lineHeight: 21, marginTop: espaco.sm },
  cartao: { alignSelf: 'stretch', marginTop: espaco.xl },
  totalLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.sm,
    marginTop: espaco.xs + 2,
  },
  total: { fontSize: 30, letterSpacing: -1.4, ...tabular },
  pilulaEconomia: {
    borderWidth: 1,
    borderRadius: raio.pill,
    paddingHorizontal: 11,
    paddingVertical: 4,
  },
  economiaTexto: { fontSize: 11, ...tabular },
  contagens: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    marginTop: espaco.md,
    paddingTop: espaco.sm + 2,
  },
  coluna: { alignItems: 'flex-start' },
  colunaValor: { fontSize: 15, ...tabular },
  colunaRotulo: { fontSize: 10.5 },
  semBase: { marginTop: espaco.md, lineHeight: 16 },
  acoes: { paddingHorizontal: espaco.xxl, paddingBottom: espaco.xl, gap: espaco.sm },
});
