/**
 * C12.1 + handoff 3a — "onde minha cesta sai mais barata?". O usuário monta uma
 * cesta buscando produtos (viram chips removíveis) e o app ranqueia os mercados
 * da região pela soma dessa cesta.
 *
 * O ranking vem do endpoint ANÔNIMO `/consulta/lista`: só ids canônicos e o
 * recorte de região viajam — nada identifica o usuário (docs/04). Cada total é
 * soma de MEDIANAS por loja (decisão travada nº6, nunca média) e promoção fica
 * de fora: é comparação entre lojas, não orçamento.
 *
 * Cobertura importa mais que o total: uma loja que só tem 2 dos 6 itens somaria
 * menos por FALTA, não por ser barata. Por isso a lista mostra a cobertura e o
 * selo "MAIS BARATO" só sai quando a loja cobre a cesta inteira.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { LojaComparacao } from '@barganha/shared';

import { clienteApi } from '@/api';
import {
  CabecalhoVoltar,
  Cartao,
  Estado,
  filtrarPorNome,
  IconeBusca,
  IconeFechar,
  IconeGrafico,
  IconeMais,
  Tela,
  Texto,
} from '@/componentes';
import { lista as listaRepo } from '@/dados';
import type { RootStackParamList } from '@/navegacao/tipos';
import * as catalogo from '@/nucleo/catalogo';
import type { ProdutoLocal } from '@/nucleo/catalogo';
import { moeda } from '@/nucleo/formato';
import { resolverLocalizacao } from '@/nucleo/localizacao';
import { espaco, raio, tabular, useTema } from '@/tema';

type Props = NativeStackScreenProps<RootStackParamList, 'CompararMercados'>;

export function CompararMercadosTela({ navigation }: Props) {
  const { c } = useTema();

  const [catalogoLocal, setCatalogoLocal] = useState<ProdutoLocal[]>([]);
  const [busca, setBusca] = useState('');
  const [cesta, setCesta] = useState<ProdutoLocal[]>([]);
  const [lojas, setLojas] = useState<LojaComparacao[]>([]);
  const [itensTotal, setItensTotal] = useState(0);
  const [comparando, setComparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [regiao, setRegiao] = useState<string | null>(null);

  // A cesta nasce com a lista de compras: quem chega aqui pela Lista já quer
  // comparar aquilo, e quem chega pelo Início começa com algo em vez do vazio.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [todos, daLista, local] = await Promise.all([
        catalogo.carregarCatalogo(),
        listaRepo.listar(),
        resolverLocalizacao(),
      ]);
      if (!vivo) return;
      setCatalogoLocal(todos);
      setRegiao(local ? (local.municipio ?? local.uf) : null);

      const ids = new Set(daLista.map((i) => i.produtoCanonicoId));
      setCesta(todos.filter((p) => p.produtoCanonicoId && ids.has(p.produtoCanonicoId)));
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const comparar = useCallback(async (atual: ProdutoLocal[]) => {
    if (atual.length === 0) {
      setLojas([]);
      setItensTotal(0);
      return;
    }
    setComparando(true);
    setErro(null);
    try {
      const local = await resolverLocalizacao();
      const r = await clienteApi.compararLista({
        itens: atual.flatMap((p) =>
          p.produtoCanonicoId ? [{ produtoCanonicoId: p.produtoCanonicoId, quantidade: 1 }] : [],
        ),
        ...(local?.municipio ? { municipio: local.municipio } : {}),
        ...(local?.uf ? { uf: local.uf } : {}),
      });
      setLojas(r.lojas);
      setItensTotal(r.itensTotal);
      if (r.lojas.length === 0) {
        setErro(
          'Ainda não há preços por loja suficientes na sua região para esta cesta. Cada cupom ' +
            'escaneado ajuda a preencher.',
        );
      }
    } catch {
      setLojas([]);
      setErro('Não deu para comparar agora. Isto precisa de internet — verifique a conexão.');
    } finally {
      setComparando(false);
    }
  }, []);

  // Recalcula a cada mudança da cesta, como no protótipo.
  useEffect(() => {
    void comparar(cesta);
  }, [cesta, comparar]);

  function adicionar(p: ProdutoLocal) {
    setBusca('');
    setCesta((atual) => (atual.some((i) => i.chave === p.chave) ? atual : [...atual, p]));
  }

  function tirar(p: ProdutoLocal) {
    setCesta((atual) => atual.filter((i) => i.chave !== p.chave));
  }

  const naCesta = new Set(cesta.map((p) => p.chave));
  const sugestoes = busca
    ? filtrarPorNome(
        catalogoLocal.filter((p) => p.produtoCanonicoId && !naCesta.has(p.chave)),
        busca,
      ).slice(0, 6)
    : [];

  // Referência do "quanto mais caro que o líder": só lojas com cobertura total
  // são comparáveis entre si; abaixo disso o total mede falta, não preço.
  const completas = lojas.filter((l) => l.itensCobertos === itensTotal);
  const lider = completas[0];
  const maiorTotal = Math.max(...lojas.map((l) => l.total), 0.01);

  return (
    <Tela>
      <CabecalhoVoltar
        titulo="Comparar mercados"
        subtitulo={regiao ? `Sua região · ${regiao}` : 'Defina sua região no Perfil'}
        aoVoltar={() => navigation.goBack()}
      />

      {/* busca */}
      <View style={[estilos.busca, { backgroundColor: c.superficie, borderColor: c.borda }]}>
        <IconeBusca tamanho={18} cor={c.fraco} />
        <TextInput
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar produto para comparar… ex.: sabão"
          placeholderTextColor={c.fraco}
          autoCorrect={false}
          style={[estilos.buscaInput, { color: c.tinta }]}
        />
      </View>

      {busca.length > 0 ? (
        sugestoes.length > 0 ? (
          <Cartao semPadding style={estilos.sugestoes}>
            {sugestoes.map((p, idx) => (
              <Pressable
                key={p.chave}
                onPress={() => adicionar(p)}
                accessibilityRole="button"
                accessibilityLabel={`Adicionar ${p.nome} à cesta`}
                style={({ pressed }) => [
                  estilos.sugestao,
                  idx < sugestoes.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: c.linha,
                  },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <IconeBusca tamanho={16} cor={c.fraco} />
                <View style={{ flex: 1 }}>
                  <Texto peso="semibold" tamanho="sm" numberOfLines={1}>
                    {p.nome}
                  </Texto>
                  <Texto cor="fraco" tamanho="xs" numerico>
                    {p.faixaPessoal?.mediana != null
                      ? `seu típico ${moeda(p.faixaPessoal.mediana)}`
                      : `${p.nObservacoes} ${p.nObservacoes === 1 ? 'compra' : 'compras'}`}
                  </Texto>
                </View>
                <View style={[estilos.mais, { backgroundColor: c.teal }]}>
                  <IconeMais tamanho={14} cor={c.sobreTeal} larguraTraco={2.5} />
                </View>
              </Pressable>
            ))}
          </Cartao>
        ) : (
          <Texto cor="fraco" tamanho="sm" centralizado style={estilos.semSugestao}>
            Nenhum produto com esse nome no seu histórico.
          </Texto>
        )
      ) : null}

      {/* chips da cesta */}
      {cesta.length > 0 ? (
        <>
          <View style={estilos.chips}>
            {cesta.map((p) => (
              <View key={p.chave} style={[estilos.chip, { backgroundColor: c.teal }]}>
                <Texto peso="semibold" cor="sobreTeal" numberOfLines={1} style={estilos.chipTexto}>
                  {p.nome}
                </Texto>
                <Pressable
                  onPress={() => tirar(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`Tirar ${p.nome} da cesta`}
                  hitSlop={8}
                >
                  <IconeFechar tamanho={11} cor={c.sobreTeal} larguraTraco={2.5} />
                </Pressable>
              </View>
            ))}
          </View>

          <Texto cor="suave" tamanho="sm" style={estilos.legenda}>
            Sua seleção — {cesta.length} {cesta.length === 1 ? 'produto' : 'produtos'} — custaria em
            cada mercado:
          </Texto>
        </>
      ) : null}

      {/* ranking */}
      {cesta.length === 0 ? (
        <View style={estilos.vazio}>
          <Estado
            icone={<IconeGrafico tamanho={30} cor={c.fraco} />}
            titulo="Nenhum produto selecionado"
            texto="Busque acima e adicione produtos para comparar os mercados da sua região."
          />
        </View>
      ) : comparando && lojas.length === 0 ? (
        <Texto cor="fraco" tamanho="sm" centralizado style={estilos.semSugestao}>
          Comparando os mercados da região…
        </Texto>
      ) : erro ? (
        <Cartao style={estilos.erro}>
          <Texto cor="suave" tamanho="sm" centralizado style={estilos.erroTexto}>
            {erro}
          </Texto>
        </Cartao>
      ) : (
        <View style={estilos.ranking}>
          {lojas.map((loja, idx) => (
            <LinhaMercado
              key={loja.lojaCnpj}
              loja={loja}
              posicao={idx + 1}
              itensTotal={itensTotal}
              /* só a líder de cobertura TOTAL ganha o selo (ver cabeçalho). */
              melhor={lider != null && loja.lojaCnpj === lider.lojaCnpj}
              diferenca={
                lider && loja.itensCobertos === itensTotal ? loja.total - lider.total : null
              }
              largura={loja.total / maiorTotal}
            />
          ))}
        </View>
      )}

      {cesta.length > 0 && lojas.length > 0 ? (
        <Texto cor="fraco" tamanho="xs" centralizado style={estilos.nota}>
          Preço típico (mediana) de cada loja na base colaborativa. É comparação entre mercados, não
          orçamento — promoções aparecem no produto.
        </Texto>
      ) : null}
    </Tela>
  );
}

function LinhaMercado({
  loja,
  posicao,
  itensTotal,
  melhor,
  diferenca,
  largura,
}: {
  loja: LojaComparacao;
  posicao: number;
  itensTotal: number;
  melhor: boolean;
  /** `null` quando a loja não cobre a cesta inteira (não dá para comparar). */
  diferenca: number | null;
  largura: number;
}) {
  const { c } = useTema();
  const completa = loja.itensCobertos === itensTotal;

  return (
    <Cartao style={estilos.mercado}>
      <View style={estilos.mercadoTopo}>
        <View style={[estilos.posicao, { backgroundColor: c.linha }]}>
          <Texto peso="bold" numerico style={estilos.posicaoTexto}>
            {posicao}
          </Texto>
        </View>

        <View style={{ flex: 1 }}>
          <Texto peso="semibold" tamanho="sm" numberOfLines={1}>
            {loja.nome ?? 'Mercado'}
          </Texto>
          <Texto cor="fraco" tamanho="xs">
            {completa
              ? `cobre a cesta inteira${loja.municipio ? ` · ${loja.municipio}` : ''}`
              : `cobre ${loja.itensCobertos} de ${itensTotal} itens`}
          </Texto>
        </View>

        {melhor ? (
          <View style={[estilos.selo, { borderColor: c.barato }]}>
            <Texto peso="bold" style={[estilos.seloTexto, { color: c.barato }]}>
              MAIS BARATO
            </Texto>
          </View>
        ) : null}
      </View>

      <View style={estilos.mercadoValores}>
        <Texto peso="bold" numerico style={estilos.mercadoTotal}>
          {moeda(loja.total)}
        </Texto>
        {diferenca != null && diferenca > 0 ? (
          <Texto peso="semibold" numerico style={[estilos.diferenca, { color: c.caro }]}>
            +{moeda(diferenca)}
          </Texto>
        ) : diferenca === 0 ? (
          <Texto peso="semibold" style={[estilos.diferenca, { color: c.barato }]}>
            melhor total
          </Texto>
        ) : (
          <Texto peso="semibold" cor="fraco" style={estilos.diferenca}>
            cobertura parcial
          </Texto>
        )}
      </View>

      <View style={[estilos.trilho, { backgroundColor: c.linha }]}>
        <View
          style={[
            estilos.preenchido,
            {
              backgroundColor: melhor ? c.barato : c.fraco,
              width: `${Math.max(6, largura * 100)}%`,
            },
          ]}
        />
      </View>
    </Cartao>
  );
}

const estilos = StyleSheet.create({
  busca: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm + 2,
    borderWidth: 1,
    borderRadius: raio.md,
    paddingHorizontal: 14,
  },
  buscaInput: { flex: 1, paddingVertical: 0, fontSize: 13.5 },
  sugestoes: { marginTop: espaco.sm, paddingHorizontal: 14 },
  sugestao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    minHeight: 44,
  },
  mais: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  semSugestao: { marginTop: espaco.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm, marginTop: espaco.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 30,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: raio.pill,
    maxWidth: '100%',
  },
  chipTexto: { fontSize: 11.5, flexShrink: 1 },
  legenda: { marginTop: espaco.lg, marginBottom: espaco.sm },
  vazio: { marginTop: espaco.xl },
  erro: { marginTop: espaco.lg },
  erroTexto: { lineHeight: 19 },
  ranking: { gap: espaco.sm + 2 },
  mercado: { padding: 14 },
  mercadoTopo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm + 2 },
  posicao: {
    width: 24,
    height: 24,
    borderRadius: raio.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posicaoTexto: { fontSize: 11 },
  selo: {
    borderWidth: 1,
    borderRadius: raio.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  seloTexto: { fontSize: 9.5, letterSpacing: 0.8 },
  mercadoValores: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: espaco.sm,
    marginTop: espaco.sm + 2,
  },
  mercadoTotal: { fontSize: 20, letterSpacing: -0.8, ...tabular },
  diferenca: { fontSize: 11.5, ...tabular },
  trilho: { height: 6, borderRadius: raio.pill, marginTop: 9, overflow: 'hidden' },
  preenchido: { height: '100%', borderRadius: raio.pill },
  nota: { marginTop: espaco.lg, lineHeight: 16 },
});
