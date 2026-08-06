/**
 * C12.1 + handoff 3a — "onde minha cesta sai mais barata?". A cesta é a LISTA DE
 * COMPRAS do usuário e o app ranqueia os mercados da região pela soma dela.
 *
 * A cesta É a lista, não uma cópia. Antes esta tela copiava a lista para o
 * estado local: adicionar e tirar aqui não gravavam nada, então sair da tela e
 * voltar ressuscitava tudo (e o mercado que vinha junto). Pior, duas cestas
 * separadas fariam a aba Lista e esta tela elegerem mercados diferentes para a
 * mesma pessoa, no mesmo minuto.
 *
 * Mas tirar do RANKING e tirar da COMPRA são intenções diferentes: quem exclui o
 * frango para ver como fica sem ele não quer perder o frango de sábado. Então o
 * "x" daqui grava `fora_comparacao` (v9) — o item sai da conta, fica na lista, e
 * continua fora quando a pessoa voltar. Apagar de verdade é a lixeira da aba
 * Lista, e só ela.
 *
 * O ranking vem do endpoint ANÔNIMO `/consulta/lista`: só ids canônicos e o
 * recorte de região viajam — nada identifica o usuário (docs/04). Cada total é
 * soma de MEDIANAS por loja (decisão travada nº6, nunca média) e promoção fica
 * de fora: é comparação entre lojas, não orçamento.
 *
 * Cobertura importa mais que o total: uma loja que só tem 2 dos 6 itens somaria
 * menos por FALTA, não por ser barata. Por isso a lista mostra a cobertura e o
 * selo "MAIS BARATO" só sai quando a loja cobre a cesta inteira — E quando o
 * dado é recente (`dadoRecente`, shared). Um típico de três meses atrás pode
 * eleger uma loja por um preço que não existe mais; nesse caso a tela mostra a
 * idade em vez do selo, porque a pessoa vai conferir na gôndola de hoje.
 *
 * A cesta é uma LISTA VERTICAL, não chips (mesma correção da Verificar): com uma
 * cesta de compras de verdade os chips viravam um bloco de nomes cortados que
 * empurrava o ranking para fora da tela. Cada linha diz em quantos mercados o
 * item tem preço e qual o menor típico — é isso que explica por que uma loja
 * cobre a cesta inteira e outra não, e qual item está furando a comparação.
 */

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { LojaComparacao } from '@barganha/shared';
import { dadoRecente, idadeEmDias } from '@barganha/shared';

import { clienteApi } from '@/api';
import {
  BloqueioPlus,
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
import type { ItemLista, ItemListaResolvido } from '@/dados/repositorio-lista';
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
import { idadeTexto, moeda } from '@/nucleo/formato';
import { resolverLocalizacao } from '@/nucleo/localizacao';
import { usePlano } from '@/plano';
import { espaco, raio, tabular, useTema } from '@/tema';

/** Espera depois da última tecla antes de consultar a região (C7.6). */
const DEBOUNCE_MS = 350;

/**
 * Itens da cesta mostrados antes do "ver todos". Com uma cesta de mercado (20+
 * itens) a lista inteira empurraria o ranking — o motivo da tela — para fora da
 * primeira dobra.
 */
const CESTA_VISIVEL = 5;

/** Item da cesta pronto para exibir: o da lista + o que o catálogo sabe dele. */
type ProdutoCesta = ProdutoBuscavel & { quantidade: number };

type Props = NativeStackScreenProps<RootStackParamList, 'CompararMercados'>;

export function CompararMercadosTela({ navigation }: Props) {
  const { c } = useTema();
  const { aplicarTeto, mostrarPlus } = usePlano();

  const [catalogoLocal, setCatalogoLocal] = useState<ProdutoLocal[]>([]);
  const [busca, setBusca] = useState('');
  const [regionais, setRegionais] = useState<ProdutoBuscavel[]>([]);
  /** A lista de compras inteira, INCLUINDO o que está fora da comparação. */
  const [itens, setItens] = useState<ItemLista[] | null>(null);
  const [lojas, setLojas] = useState<LojaComparacao[]>([]);
  const [itensTotal, setItensTotal] = useState(0);
  const [comparando, setComparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [regiao, setRegiao] = useState<string | null>(null);
  /** Cesta longa nasce recolhida (ver `CESTA_VISIVEL`). */
  const [verTudo, setVerTudo] = useState(false);
  /** Bloco dos excluídos aberto — fechado por padrão para não roubar a dobra. */
  const [verExcluidos, setVerExcluidos] = useState(false);

  const recarregar = useCallback(async () => {
    const [todos, daLista, local] = await Promise.all([
      catalogo.carregarCatalogo(),
      listaRepo.listar(),
      resolverLocalizacao(),
    ]);
    setCatalogoLocal(todos);
    setItens(daLista);
    setRegiao(local ? (local.municipio ?? local.uf) : null);
  }, []);

  // Recarrega a cada foco, não só na montagem: item posto na aba Lista tem de
  // aparecer aqui, e o que esta tela grava precisa ser lido de volta do banco
  // (o banco é a verdade, o estado da tela é só um espelho).
  useFocusEffect(
    useCallback(() => {
      void recarregar();
    }, [recarregar]),
  );

  /**
   * Cesta exibível: a lista MENOS os excluídos, cada item enriquecido com o que
   * o catálogo local sabe dele.
   *
   * O nome vem da LISTA e não da interseção com o histórico: desde o C7.6 a
   * lista pode ter produto vindo do catálogo regional, que o usuário nunca
   * comprou — antes ele sumia calado daqui.
   */
  const doHistorico = useMemo(
    () => new Map(comparaveis(catalogoLocal).map((p) => [p.produtoCanonicoId, p])),
    [catalogoLocal],
  );
  const enriquecer = useCallback(
    (i: ItemListaResolvido): ProdutoCesta => ({
      ...(doHistorico.get(i.produtoCanonicoId) ?? {
        chave: i.produtoCanonicoId,
        produtoCanonicoId: i.produtoCanonicoId,
        nome: i.nome,
        unidadeBase: null,
        origem: 'regiao' as const,
      }),
      quantidade: i.quantidade,
    }),
    [doHistorico],
  );

  const comparaveisDaLista = useMemo(
    () => (itens ? listaRepo.cestaComparavel(itens) : []),
    [itens],
  );
  const cesta = useMemo(() => comparaveisDaLista.map(enriquecer), [comparaveisDaLista, enriquecer]);
  // Item PENDENTE ("a escolher no mercado") nunca chega a `foraComparacao = true`
  // na prática (só a cesta já resolvida passa por `definirForaComparacao`), mas o
  // filtro por tipo aqui é o que deixa isso EXPLÍCITO para o compilador — sem
  // ele, `i.produtoCanonicoId` desta lista continuaria `string | null`.
  const excluidos = useMemo(
    () =>
      (itens ?? []).filter(
        (i): i is ItemListaResolvido => i.foraComparacao && i.produtoCanonicoId != null,
      ),
    [itens],
  );

  const comparar = useCallback(async (atual: readonly ItemListaResolvido[]) => {
    if (atual.length === 0) {
      setLojas([]);
      setItensTotal(0);
      setErro(null);
      return;
    }
    setComparando(true);
    setErro(null);
    try {
      const local = await resolverLocalizacao();
      const r = await clienteApi.compararLista({
        // Quantidade REAL de cada item. Mandar 1 para tudo (como antes) dava um
        // total diferente do da aba Lista para a mesma cesta e podia inverter o
        // ranking: quem leva 6 arrozes e 1 sal não compra "1 de cada".
        itens: atual.map((i) => ({
          produtoCanonicoId: i.produtoCanonicoId,
          quantidade: i.quantidade,
        })),
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

  /**
   * Recalcula quando a cesta muda de CONTEÚDO — ids e quantidades, que é tudo o
   * que o endpoint recebe. A assinatura existe porque `comparaveisDaLista` é um
   * array novo a cada recarga de foco: depender dele refaria a requisição a cada
   * volta para a tela, mesmo sem nada ter mudado.
   */
  const assinatura = comparaveisDaLista
    .map((i) => `${i.produtoCanonicoId}x${i.quantidade}`)
    .join('|');
  const cestaRef = useRef(comparaveisDaLista);
  cestaRef.current = comparaveisDaLista;
  // `carregou` é booleano de propósito: depender de `itens` (array novo a cada
  // foco) anularia a assinatura e a requisição voltaria a sair sem motivo.
  const carregou = itens != null;
  useEffect(() => {
    if (!carregou) return;
    void comparar(cestaRef.current);
  }, [assinatura, carregou, comparar]);

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

  /**
   * Adicionar aqui adiciona na LISTA DE COMPRAS — é a mesma cesta (ver
   * cabeçalho). Se o item já estava lá mas fora da comparação, o `adicionar` do
   * repositório o traz de volta para a conta.
   */
  const adicionar = useCallback(
    (p: ProdutoBuscavel) => {
      setBusca('');
      void (async () => {
        await listaRepo.adicionar(p.produtoCanonicoId, p.nome);
        await recarregar();
      })();
    },
    [recarregar],
  );

  /** Tira do RANKING, não da lista: o item continua na compra (ver cabeçalho). */
  const tirar = useCallback(
    (produtoCanonicoId: string) => {
      void (async () => {
        await listaRepo.definirForaComparacao(produtoCanonicoId, true);
        await recarregar();
      })();
    },
    [recarregar],
  );

  const devolver = useCallback(
    (produtoCanonicoId: string) => {
      void (async () => {
        await listaRepo.definirForaComparacao(produtoCanonicoId, false);
        await recarregar();
      })();
    },
    [recarregar],
  );

  const devolverTodos = useCallback(() => {
    void (async () => {
      await listaRepo.incluirTodosNaComparacao();
      await recarregar();
    })();
  }, [recarregar]);

  // Busca não sugere o que já está na lista — nem o que foi excluído, que já
  // aparece no bloco "fora da comparação" com o botão de devolver.
  const naLista = new Set((itens ?? []).map((i) => i.produtoCanonicoId));
  const sugestoes = busca
    ? mesclar(filtrarLocais(catalogoLocal, busca), regionais)
        .filter((p) => !naLista.has(p.produtoCanonicoId))
        .slice(0, 6)
    : [];

  // Referência do "quanto mais caro que o líder": só lojas com cobertura total
  // são comparáveis entre si; abaixo disso o total mede falta, não preço. A
  // referência NÃO olha frescor — "+R$ 8" é um fato sobre os totais exibidos.
  const completas = lojas.filter((l) => l.itensCobertos === itensTotal);
  const lider = completas[0];
  const maiorTotal = Math.max(...lojas.map((l) => l.total), 0.01);

  /**
   * "Agora" de referência do frescor, congelado por rodada de comparação: se
   * cada linha chamasse `new Date()`, duas linhas da mesma tela poderiam cair em
   * lados opostos do limiar.
   */
  const agora = useMemo(() => new Date(), [lojas]);

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

  /**
   * C13.5 — teto de mercados do plano. O corte é só de EXIBIÇÃO e vem DEPOIS de
   * `lider`/`maiorTotal`, que continuam calculados sobre o ranking inteiro: o
   * mais barato é o mesmo nos dois planos, e como a lista já vem em ordem
   * crescente ele nunca cai fora do teto. Quem não paga vê a resposta certa —
   * perde só a cauda do ranking (regra travada nº 2, docs/21).
   */
  const { visiveis: lojasVisiveis, ocultos: lojasOcultas } = aplicarTeto('mercadosNaCesta', lojas);

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
          placeholder="Buscar produto para a lista"
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
                accessibilityLabel={`Adicionar ${p.nome} à sua lista e à comparação`}
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
            {/* "Sua lista", não "sua cesta": é a mesma lista da aba Lista. */}
            <Eyebrow>Sua lista</Eyebrow>
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
                aoTirar={() => tirar(p.produtoCanonicoId)}
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

      {/*
        Excluídos da comparação. Precisa existir: sem este bloco o item sai do
        ranking e fica INALCANÇÁVEL daqui — a pessoa teria de ir até a aba Lista
        adivinhar o que aconteceu. Fechado por padrão para não roubar a dobra.
      */}
      {excluidos.length > 0 ? (
        <>
          <Pressable
            onPress={() => setVerExcluidos((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: verExcluidos }}
            style={({ pressed }) => [estilos.cabecalhoSecao, pressed && { opacity: 0.6 }]}
          >
            <Eyebrow>Fora da comparação</Eyebrow>
            <Texto cor="fraco" tamanho="xs" numerico>
              {excluidos.length} · {verExcluidos ? 'ocultar' : 'ver'}
            </Texto>
          </Pressable>

          {verExcluidos ? (
            <CartaoLista>
              {excluidos.map((i, idx) => (
                <View
                  key={i.produtoCanonicoId}
                  style={[
                    estilos.item,
                    idx < excluidos.length - 1 && {
                      borderBottomWidth: 1,
                      borderBottomColor: c.linha,
                    },
                  ]}
                >
                  <View style={estilos.itemTexto}>
                    <Texto peso="semibold" tamanho="sm" numberOfLines={2}>
                      {i.nome}
                    </Texto>
                    <Texto cor="fraco" numerico numberOfLines={1} style={estilos.itemSub}>
                      continua na sua lista de compras
                    </Texto>
                  </View>

                  <Pressable
                    onPress={() => devolver(i.produtoCanonicoId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Devolver ${i.nome} à comparação`}
                    hitSlop={8}
                    style={({ pressed }) => [
                      estilos.mais,
                      { backgroundColor: c.teal },
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <IconeMais tamanho={14} cor={c.sobreTeal} larguraTraco={2.5} />
                  </Pressable>
                </View>
              ))}

              {excluidos.length > 1 ? (
                <Pressable
                  onPress={devolverTodos}
                  accessibilityRole="button"
                  style={({ pressed }) => [estilos.verTudo, pressed && { opacity: 0.6 }]}
                >
                  <Texto peso="bold" tamanho="sm" style={{ color: c.tinta }}>
                    Devolver todos
                  </Texto>
                </Pressable>
              ) : null}
            </CartaoLista>
          ) : null}
        </>
      ) : null}

      {/* ranking */}
      {cesta.length === 0 ? (
        <View style={estilos.vazio}>
          <Estado
            icone={<IconeGrafico tamanho={30} cor={c.fraco} />}
            titulo={excluidos.length > 0 ? 'Cesta vazia na comparação' : 'Sua lista está vazia'}
            texto={
              excluidos.length > 0
                ? 'Você tirou todos os produtos da comparação. Devolva algum acima para ver o ranking.'
                : 'Busque acima para pôr produtos na sua lista de compras — o ranking dos mercados sai dela.'
            }
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
            {lojasVisiveis.map((loja, idx) => (
              <LinhaMercado
                key={loja.lojaCnpj}
                loja={loja}
                posicao={idx + 1}
                itensTotal={itensTotal}
                /* líder de cobertura TOTAL — o selo ainda depende do frescor. */
                lidera={lider != null && loja.lojaCnpj === lider.lojaCnpj}
                diferenca={
                  lider && loja.itensCobertos === itensTotal ? loja.total - lider.total : null
                }
                largura={loja.total / maiorTotal}
                agora={agora}
              />
            ))}

            {lojasOcultas > 0 ? (
              <BloqueioPlus
                titulo={
                  lojasOcultas === 1
                    ? '+1 mercado no ranking'
                    : `+${lojasOcultas} mercados no ranking`
                }
                texto="O ranking completo da sua região é do Barganha+."
                onPress={mostrarPlus}
              />
            ) : null}
          </View>
        </>
      )}

      {cesta.length > 0 && lojas.length > 0 ? (
        <Texto cor="fraco" tamanho="xs" centralizado style={estilos.nota}>
          Preço típico (mediana) de cada loja na base colaborativa — é uma estimativa, não o preço
          da gôndola de hoje. Comparação entre mercados, não orçamento; promoções não entram no
          total.
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
  produto: ProdutoCesta;
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
          {/* A quantidade tem de aparecer: ela entra na conta do ranking. */}
          {produto.quantidade > 1 ? `${produto.quantidade}× ` : ''}
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
        accessibilityLabel={`Tirar ${produto.nome} da comparação; continua na sua lista`}
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

/**
 * Uma loja no ranking. Além do total, mostra a EVIDÊNCIA por trás dele — quantos
 * preços entraram e a idade do mais velho. É o que separa "confie em mim" de "eis
 * o que eu sei": um total de R$ 180 apoiado em 6 preços de abril e outro apoiado
 * em 200 preços da semana passada não podem ser exibidos igual.
 *
 * O selo "MAIS BARATO" exige cobertura total E dado recente. Quando a líder tem
 * dado velho, o lugar do selo mostra a idade: ela continua em primeiro (o total é
 * o que é), mas sem recomendação — a pessoa confere na gôndola.
 */
function LinhaMercado({
  loja,
  posicao,
  itensTotal,
  lidera,
  diferenca,
  largura,
  agora,
}: {
  loja: LojaComparacao;
  posicao: number;
  itensTotal: number;
  /** Menor total entre as lojas de cobertura TOTAL (candidata ao selo). */
  lidera: boolean;
  /** `null` quando a loja não cobre a cesta inteira (não dá para comparar). */
  diferenca: number | null;
  largura: number;
  agora: Date;
}) {
  const { c } = useTema();
  const completa = loja.itensCobertos === itensTotal;

  const idade = idadeEmDias(loja.observadoEmMaisAntigo, agora);
  const recente = dadoRecente(loja.observadoEmMaisAntigo, agora);
  // Só a líder de cobertura total E com dado recente é recomendada.
  const melhor = lidera && recente;

  // Cada pedaço só entra se o backend mandou o campo. Um app atualizado por OTA
  // pode falar com um backend anterior a estes campos (docs/19); ali a resposta
  // honesta é omitir o pedaço, não escrever "undefined preços" nem inventar 0.
  const evidencia = [
    ...(loja.nObservacoes != null
      ? [`${loja.nObservacoes} ${loja.nObservacoes === 1 ? 'preço' : 'preços'}`]
      : []),
    `mais antigo ${idadeTexto(idade)}`,
    ...(loja.itensComPromocao ? [`${loja.itensComPromocao} em promoção fora do total`] : []),
  ].join(' · ');

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
        ) : lidera ? (
          // Lidera mas o dado é velho: diz o motivo em vez de recomendar.
          <View style={[estilos.selo, { borderColor: c.borda }]}>
            <Texto peso="bold" style={[estilos.seloTexto, { color: c.fraco }]}>
              SEM DADO RECENTE
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

      <Texto cor="fraco" numerico numberOfLines={2} style={estilos.evidencia}>
        {evidencia}
      </Texto>
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
  evidencia: { fontSize: 10.5, marginTop: 8, lineHeight: 14 },
  nota: { marginTop: espaco.lg, lineHeight: 16 },
});
