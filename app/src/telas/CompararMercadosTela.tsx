/**
 * C12.1 + handoff 3a — "onde minha cesta sai mais barata?". O usuário monta uma
 * cesta buscando produtos e o app ranqueia os mercados da região pela soma
 * dessa cesta.
 *
 * O ranking vem do endpoint ANÔNIMO `/consulta/lista`: só ids canônicos e o
 * recorte de região viajam — nada identifica o usuário (docs/04). Cada total é
 * soma de MEDIANAS por loja (decisão travada nº6, nunca média) e promoção fica
 * de fora: é comparação entre lojas, não orçamento.
 *
 * Cobertura importa mais que o total: uma loja que só tem 2 dos 6 itens somaria
 * menos por FALTA, não por ser barata. Por isso a lista mostra a cobertura e o
 * selo "MAIS BARATO" só sai quando a loja cobre a cesta inteira.
 *
 * A cesta é uma LISTA VERTICAL, não chips (mesma correção da Verificar): com uma
 * cesta de compras de verdade os chips viravam um bloco de nomes cortados que
 * empurrava o ranking para fora da tela. Cada linha diz em quantos mercados o
 * item tem preço e qual o menor típico — é isso que explica por que uma loja
 * cobre a cesta inteira e outra não, e qual item está furando a comparação.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { LojaComparacao } from '@barganha/shared';

import { clienteApi } from '@/api';
import {
  CabecalhoVoltar,
  Cartao,
  CartaoLista,
  Estado,
  Eyebrow,
  IconeBusca,
  IconeFechar,
  IconeGrafico,
  IconeMais,
  Tela,
  Texto,
} from '@/componentes';
import { lista as listaRepo } from '@/dados';
import type { RootStackParamList } from '@/navegacao/tipos';
import {
  buscarNaRegiao,
  comparaveis,
  filtrarLocais,
  mesclar,
  type ProdutoBuscavel,
} from '@/nucleo/busca-produtos';
import * as catalogo from '@/nucleo/catalogo';
import type { ProdutoLocal } from '@/nucleo/catalogo';
import { moeda } from '@/nucleo/formato';
import { resolverLocalizacao } from '@/nucleo/localizacao';
import { espaco, raio, tabular, useTema } from '@/tema';

/** Espera depois da última tecla antes de consultar a região (C7.6). */
const DEBOUNCE_MS = 350;

/**
 * Itens da cesta mostrados antes do "ver todos". Com uma cesta de mercado (20+
 * itens) a lista inteira empurraria o ranking — o motivo da tela — para fora da
 * primeira dobra.
 */
const CESTA_VISIVEL = 5;

type Props = NativeStackScreenProps<RootStackParamList, 'CompararMercados'>;

export function CompararMercadosTela({ navigation }: Props) {
  const { c } = useTema();

  const [catalogoLocal, setCatalogoLocal] = useState<ProdutoLocal[]>([]);
  const [busca, setBusca] = useState('');
  const [regionais, setRegionais] = useState<ProdutoBuscavel[]>([]);
  const [cesta, setCesta] = useState<ProdutoBuscavel[]>([]);
  const [lojas, setLojas] = useState<LojaComparacao[]>([]);
  const [itensTotal, setItensTotal] = useState(0);
  const [comparando, setComparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [regiao, setRegiao] = useState<string | null>(null);
  /** Cesta longa nasce recolhida (ver `CESTA_VISIVEL`). */
  const [verTudo, setVerTudo] = useState(false);

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

      // A cesta sai da LISTA, não da interseção com o histórico: desde o C7.6 a
      // lista pode ter produto que veio do catálogo regional e que o usuário
      // nunca comprou — antes ele sumia calado daqui.
      const doHistorico = new Map(comparaveis(todos).map((p) => [p.produtoCanonicoId, p]));
      setCesta(
        daLista.map(
          (i) =>
            doHistorico.get(i.produtoCanonicoId) ?? {
              chave: i.produtoCanonicoId,
              produtoCanonicoId: i.produtoCanonicoId,
              nome: i.nome,
              unidadeBase: null,
              origem: 'regiao' as const,
            },
        ),
      );
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const comparar = useCallback(async (atual: ProdutoBuscavel[]) => {
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
        itens: atual.map((p) => ({ produtoCanonicoId: p.produtoCanonicoId, quantidade: 1 })),
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

  /**
   * Busca na região com debounce e descarte de resposta atrasada (o resultado de
   * "arr" não pode chegar depois do de "arroz" e sobrescrevê-lo). Só com texto:
   * aqui, diferente do sheet da Lista, uma vitrine de populares competiria com a
   * cesta que a pessoa veio comparar.
   */
  const rodada = useRef(0);
  useEffect(() => {
    if (!busca.trim()) {
      setRegionais([]);
      return;
    }
    const minha = ++rodada.current;
    const timer = setTimeout(() => {
      void buscarNaRegiao(busca).then((r) => {
        if (rodada.current === minha) setRegionais(r);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [busca]);

  function adicionar(p: ProdutoBuscavel) {
    setBusca('');
    setCesta((atual) =>
      atual.some((i) => i.produtoCanonicoId === p.produtoCanonicoId) ? atual : [...atual, p],
    );
  }

  function tirar(p: ProdutoBuscavel) {
    setCesta((atual) => atual.filter((i) => i.produtoCanonicoId !== p.produtoCanonicoId));
  }

  const naCesta = new Set(cesta.map((p) => p.produtoCanonicoId));
  const sugestoes = busca
    ? mesclar(filtrarLocais(catalogoLocal, busca), regionais)
        .filter((p) => !naCesta.has(p.produtoCanonicoId))
        .slice(0, 6)
    : [];

  // Referência do "quanto mais caro que o líder": só lojas com cobertura total
  // são comparáveis entre si; abaixo disso o total mede falta, não preço.
  const completas = lojas.filter((l) => l.itensCobertos === itensTotal);
  const lider = completas[0];
  const maiorTotal = Math.max(...lojas.map((l) => l.total), 0.01);

  // Em quantos mercados cada item tem preço, e o menor típico entre eles. É o
  // que a linha da cesta mostra: sem isso a cobertura parcial do ranking fica
  // sem explicação ("qual item ninguém tem?").
  const resumoItem = new Map<string, { mercados: number; menor: number }>();
  for (const loja of lojas) {
    for (const item of loja.itens) {
      if (item.preco == null) continue;
      const atual = resumoItem.get(item.produtoCanonicoId);
      resumoItem.set(item.produtoCanonicoId, {
        mercados: (atual?.mercados ?? 0) + 1,
        menor: Math.min(atual?.menor ?? item.preco, item.preco),
      });
    }
  }

  const recolhida = !verTudo && cesta.length > CESTA_VISIVEL;
  const cestaVisivel = recolhida ? cesta.slice(0, CESTA_VISIVEL) : cesta;

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
          placeholder="Buscar produto para comparar"
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
                    {p.tipico == null
                      ? 'sem preço típico ainda'
                      : p.origem === 'historico'
                        ? `seu típico ${moeda(p.tipico)}`
                        : `típico na região ${moeda(p.tipico)}`}
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
            Nenhum produto com esse nome no seu histórico nem na sua região.
          </Texto>
        )
      ) : null}

      {/* cesta */}
      {cesta.length > 0 ? (
        <>
          <View style={estilos.cabecalhoSecao}>
            <Eyebrow>Sua cesta</Eyebrow>
            <Texto cor="fraco" tamanho="xs" numerico>
              {cesta.length} {cesta.length === 1 ? 'produto' : 'produtos'}
            </Texto>
          </View>

          <CartaoLista>
            {cestaVisivel.map((p, idx) => (
              <ItemCesta
                key={p.chave}
                produto={p}
                resumo={resumoItem.get(p.produtoCanonicoId) ?? null}
                mercados={lojas.length}
                ultima={idx === cestaVisivel.length - 1 && !recolhida}
                aoTirar={() => tirar(p)}
              />
            ))}

            {recolhida ? (
              <Pressable
                onPress={() => setVerTudo(true)}
                accessibilityRole="button"
                style={({ pressed }) => [estilos.verTudo, pressed && { opacity: 0.6 }]}
              >
                <Texto peso="bold" tamanho="sm" style={{ color: c.tinta }}>
                  Ver os {cesta.length} produtos
                </Texto>
              </Pressable>
            ) : null}
          </CartaoLista>
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
        <>
          {/* sem loja nenhuma não há seção — o cabeçalho anunciaria um vazio. */}
          {lojas.length > 0 ? (
            <View style={estilos.cabecalhoSecao}>
              <Eyebrow>Onde sai mais barato</Eyebrow>
              <Texto cor="fraco" tamanho="xs" numerico>
                {lojas.length} {lojas.length === 1 ? 'mercado' : 'mercados'}
              </Texto>
            </View>
          ) : null}

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
        </>
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

/**
 * Linha da cesta. O subtítulo é o "porquê" da cobertura: em quantos mercados o
 * item tem preço e o menor típico entre eles. Sem ranking ainda (offline, erro,
 * cesta recém-montada) cai para o típico que o próprio produto trouxe.
 */
function ItemCesta({
  produto,
  resumo,
  mercados,
  ultima,
  aoTirar,
}: {
  produto: ProdutoBuscavel;
  resumo: { mercados: number; menor: number } | null;
  /** Total de mercados no ranking; 0 quando ainda não há comparação. */
  mercados: number;
  ultima: boolean;
  aoTirar: () => void;
}) {
  const { c } = useTema();
  const sufixo = produto.unidadeBase ? `/${produto.unidadeBase}` : '';

  let detalhe: string;
  if (mercados === 0) {
    detalhe =
      produto.tipico == null
        ? 'sem preço típico ainda'
        : produto.origem === 'historico'
          ? `seu típico ${moeda(produto.tipico)}${sufixo}`
          : `típico na região ${moeda(produto.tipico)}${sufixo}`;
  } else if (resumo == null) {
    detalhe = 'nenhum mercado daqui tem preço deste';
  } else {
    detalhe = `${resumo.mercados} de ${mercados} mercados · menor ${moeda(resumo.menor)}`;
  }

  return (
    <View style={[estilos.item, !ultima && { borderBottomWidth: 1, borderBottomColor: c.linha }]}>
      <View style={estilos.itemTexto}>
        <Texto peso="semibold" tamanho="sm" numberOfLines={2}>
          {produto.nome}
        </Texto>
        <Texto
          cor={resumo == null && mercados > 0 ? 'suave' : 'fraco'}
          numerico
          numberOfLines={1}
          style={estilos.itemSub}
        >
          {detalhe}
        </Texto>
      </View>

      <Pressable
        onPress={aoTirar}
        accessibilityRole="button"
        accessibilityLabel={`Tirar ${produto.nome} da cesta`}
        hitSlop={8}
        style={({ pressed }) => [
          estilos.tirar,
          { backgroundColor: c.linha },
          pressed && { opacity: 0.6 },
        ]}
      >
        <IconeFechar tamanho={12} cor={c.fraco} larguraTraco={2.5} />
      </Pressable>
    </View>
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
  cabecalhoSecao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
    marginTop: espaco.lg,
    marginBottom: espaco.sm,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, paddingVertical: 13 },
  itemTexto: { flex: 1 },
  itemSub: { fontSize: 11.5, marginTop: 2 },
  tirar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verTudo: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
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
