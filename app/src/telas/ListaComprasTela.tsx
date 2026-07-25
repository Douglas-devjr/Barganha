/**
 * C12.1 + handoff 3a — Lista de compras (aba). Substituiu "Produtos" na barra:
 * montar a compra é a tarefa recorrente; o catálogo virou atalho daqui.
 *
 * A tela responde duas perguntas:
 *   1. "quanto isso vai dar?" — ESTIMATIVA pelos típicos da região (mediana,
 *      nunca média — decisão travada nº6) e quanto sairia no mercado mais barato;
 *   2. "este preço aqui na gôndola tá bom?" — cada item tem um campo de preço
 *      que dispara o veredito na hora (abaixo / na média / acima do típico).
 *
 * A caixa de seleção marca o que já está no carrinho (persistida). O preço
 * digitado NÃO persiste: é da ida ao mercado, envelhece em horas.
 *
 * Tudo offline: a lista é local e os típicos vêm do `cache_estatistica` baixado
 * pelo delta sync. Só o ranking por loja ("no Assaí sai por…") precisa de rede,
 * e a ausência dele não impede nada.
 */

import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  Cartao,
  CartaoLista,
  Dialogo,
  Estado,
  Eyebrow,
  FolhaAdicionarItem,
  IconeCheck,
  IconeLista,
  IconeLixeira,
  IconeMais,
  Texto,
  Tela,
  TituloTela,
  useToast,
} from '@/componentes';
import { clienteApi } from '@/api';
import { lista as listaRepo } from '@/dados';
import type { ItemLista } from '@/dados/repositorio-lista';
import type { RootStackParamList, TabParamList } from '@/navegacao/tipos';
import type { ProdutoBuscavel } from '@/nucleo/busca-produtos';
import * as catalogo from '@/nucleo/catalogo';
import type { ProdutoLocal } from '@/nucleo/catalogo';
import { moeda, parseMoeda } from '@/nucleo/formato';
import { resolverLocalizacao } from '@/nucleo/localizacao';
import { sincronizarEstatisticas } from '@/nucleo/sincronizador';
import { tipicosDaRegiao, type TipicoRegional } from '@/nucleo/tipico-regional';
import { espaco, raio, tabular, useTema } from '@/tema';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Lista'>,
  NativeStackScreenProps<RootStackParamList>
>;

/**
 * Faixa em que o preço da gôndola conta como "na média". É o mesmo ±5% que o
 * protótipo usa no veredito de Verificar — dentro dela a diferença é ruído da
 * amostra, não barganha.
 */
const TOLERANCIA = 0.05;

type Veredito = 'abaixo' | 'media' | 'acima';

function classificar(preco: number, tipico: number): Veredito {
  const v = (preco - tipico) / tipico;
  if (v <= -TOLERANCIA) return 'abaixo';
  if (v >= TOLERANCIA) return 'acima';
  return 'media';
}

export function ListaComprasTela({ navigation }: Props) {
  const { c } = useTema();
  const toast = useToast();

  const [itens, setItens] = useState<ItemLista[] | null>(null);
  const [tipicos, setTipicos] = useState<Map<string, TipicoRegional>>(new Map());
  const [produtos, setProdutos] = useState<ProdutoLocal[]>([]);
  /** Preço da gôndola por item — só em memória (ver cabeçalho do arquivo). */
  const [precos, setPrecos] = useState<Record<string, string>>({});
  const [adicionando, setAdicionando] = useState(false);
  const [removendo, setRemovendo] = useState<ItemLista | null>(null);
  /** Total da cesta na loja mais barata da região; `null` = sem rede/sem dado. */
  const [melhorLoja, setMelhorLoja] = useState<{ nome: string; total: number } | null>(null);

  const recarregar = useCallback(async () => {
    const atual = await listaRepo.listar();
    setItens(atual);
    setTipicos(await tipicosDaRegiao(atual.map((i) => i.produtoCanonicoId)));
    setProdutos(await catalogo.carregarCatalogo());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void recarregar();
    }, [recarregar]),
  );

  /**
   * Ranking por loja — o único pedaço que precisa de rede. Falha em silêncio:
   * a estimativa pelos típicos já responde a pergunta principal offline.
   */
  const buscarMelhorLoja = useCallback(async (atuais: ItemLista[]) => {
    if (atuais.length === 0) return setMelhorLoja(null);
    try {
      const local = await resolverLocalizacao();
      const r = await clienteApi.compararLista({
        itens: atuais.map((i) => ({
          produtoCanonicoId: i.produtoCanonicoId,
          quantidade: i.quantidade,
        })),
        ...(local?.municipio ? { municipio: local.municipio } : {}),
        ...(local?.uf ? { uf: local.uf } : {}),
      });
      const primeira = r.lojas[0];
      // Só vale como "sai por" se a loja cobre a lista inteira; cobertura
      // parcial daria um total menor por FALTA de itens, não por ser barata.
      setMelhorLoja(
        primeira && primeira.itensCobertos === r.itensTotal
          ? { nome: primeira.nome ?? 'mercado da região', total: primeira.total }
          : null,
      );
    } catch {
      setMelhorLoja(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (itens) void buscarMelhorLoja(itens);
    }, [itens, buscarMelhorLoja]),
  );

  async function alternarMarcado(item: ItemLista) {
    await listaRepo.definirMarcado(item.produtoCanonicoId, !item.marcado);
    setItens(
      (atual) =>
        atual?.map((i) =>
          i.produtoCanonicoId === item.produtoCanonicoId ? { ...i, marcado: !i.marcado } : i,
        ) ?? null,
    );
  }

  /**
   * O produto pode vir do histórico OU do catálogo da região (C7.6) — a lista
   * guarda id canônico + nome, que os dois têm. Depois de entrar aqui, o id
   * passa a fazer parte do recorte do delta sync (C7.7) e o típico do item
   * funciona offline na próxima sincronização.
   */
  async function adicionar(p: ProdutoBuscavel) {
    await listaRepo.adicionar(p.produtoCanonicoId, p.nome);
    await recarregar();
    toast(`“${p.nome}” entrou na lista`);
    // O item novo acabou de entrar no recorte do sync (C7.7): puxar agora é o
    // que faz o típico dele existir offline já na próxima abertura da tela.
    void sincronizarEstatisticas().catch(() => {});
  }

  async function remover(item: ItemLista) {
    await listaRepo.remover(item.produtoCanonicoId);
    setRemovendo(null);
    setPrecos((atual) => {
      const resto = { ...atual };
      delete resto[item.produtoCanonicoId];
      return resto;
    });
    await recarregar();
    toast(`“${item.nome}” saiu da lista`);
  }

  // ---- somatórios -----------------------------------------------------------

  // Estimativa: soma dos típicos × quantidade. Item sem típico na região fica de
  // fora do total (e a nota abaixo do card diz quantos são) — somar zero por ele
  // faria a estimativa parecer mais barata do que a compra vai ser.
  let estimativa = 0;
  let semTipico = 0;
  let naGondola = 0;
  let conferidos = 0;

  for (const item of itens ?? []) {
    const tipico = tipicos.get(item.produtoCanonicoId);
    if (tipico) estimativa += tipico.mediana * item.quantidade;
    else semTipico += 1;

    const digitado = parseMoeda(precos[item.produtoCanonicoId] ?? '');
    if (digitado != null) {
      naGondola += digitado * item.quantidade;
      conferidos += 1;
    }
  }

  const jaNaLista = new Set((itens ?? []).map((i) => i.produtoCanonicoId));

  // ---- render ---------------------------------------------------------------

  const cabecalho = (
    <TituloTela
      titulo="Lista de compras"
      direita={
        itens && itens.length > 0 ? (
          <Texto peso="semibold" cor="suave" numerico style={estilos.contador}>
            {itens.length} {itens.length === 1 ? 'item' : 'itens'}
          </Texto>
        ) : undefined
      }
    />
  );

  // `null` = ainda carregando; não piscar o vazio para quem tem lista.
  if (itens == null) return <Tela>{cabecalho}</Tela>;

  if (itens.length === 0) {
    return (
      <Tela>
        {cabecalho}
        <View style={estilos.vazio}>
          <Estado
            icone={<IconeLista tamanho={32} cor={c.fraco} />}
            titulo="Sua lista está vazia"
            texto={
              'Adicione os produtos que pretende comprar e a gente estima quanto vai custar na ' +
              'sua região.'
            }
            acao={{ titulo: 'Adicionar item', onPress: () => setAdicionando(true) }}
            acaoSecundaria={{
              titulo: 'Ver meus produtos',
              onPress: () => navigation.navigate('Produtos'),
              variante: 'fantasma',
            }}
          />
        </View>

        <FolhaAdicionarItem
          visivel={adicionando}
          candidatos={produtos}
          jaNaLista={jaNaLista}
          aoAdicionar={(p) => void adicionar(p)}
          aoFechar={() => setAdicionando(false)}
        />
      </Tela>
    );
  }

  return (
    <Tela>
      {cabecalho}
      <Texto cor="suave" tamanho="sm" style={estilos.subtitulo}>
        Monte a lista para a sua próxima compra.
      </Texto>

      {/* estimativa da lista */}
      <Cartao style={estilos.cartaoEstimativa}>
        <View style={estilos.estimativaTopo}>
          <Eyebrow>Estimativa da lista</Eyebrow>
          {melhorLoja ? (
            <Texto peso="semibold" numerico style={[estilos.melhorLoja, { color: c.barato }]}>
              no {melhorLoja.nome} sai por {moeda(melhorLoja.total)}
            </Texto>
          ) : null}
        </View>

        <Texto peso="bold" numerico style={estilos.estimativaValor}>
          {moeda(estimativa)}
        </Texto>
        <Texto cor="suave" tamanho="sm" style={estilos.estimativaNota}>
          pelos preços típicos da sua região
        </Texto>

        {conferidos > 0 ? (
          <View style={[estilos.gondolaLinha, { borderTopColor: c.cartaoBorda }]}>
            <Eyebrow>Na gôndola até agora</Eyebrow>
            <Texto peso="bold" tamanho="md" numerico>
              {moeda(naGondola)}
            </Texto>
          </View>
        ) : null}
      </Cartao>

      {semTipico > 0 ? (
        <Texto cor="fraco" tamanho="xs" style={estilos.aviso}>
          {semTipico === 1
            ? '1 item ainda não tem preço na sua região e ficou fora da estimativa.'
            : `${semTipico} itens ainda não têm preço na sua região e ficaram fora da estimativa.`}
        </Texto>
      ) : null}

      {/* itens */}
      <CartaoLista style={estilos.lista}>
        {itens.map((item, idx) => (
          <ItemDaLista
            key={item.produtoCanonicoId}
            item={item}
            tipico={tipicos.get(item.produtoCanonicoId)}
            precoTexto={precos[item.produtoCanonicoId] ?? ''}
            ultima={idx === itens.length - 1}
            aoMarcar={() => void alternarMarcado(item)}
            aoDigitarPreco={(texto) =>
              setPrecos((atual) => ({ ...atual, [item.produtoCanonicoId]: texto }))
            }
            aoRemover={() => setRemovendo(item)}
          />
        ))}
      </CartaoLista>

      {/* adicionar */}
      <Pressable
        onPress={() => setAdicionando(true)}
        accessibilityRole="button"
        style={({ pressed }) => [
          estilos.adicionar,
          { borderColor: c.borda },
          pressed && { opacity: 0.6 },
        ]}
      >
        <View style={[estilos.adicionarTile, { backgroundColor: c.linha }]}>
          <IconeMais tamanho={17} cor={c.tinta} />
        </View>
        <Texto peso="semibold" cor="suave" tamanho="sm">
          Adicionar item à lista
        </Texto>
      </Pressable>

      <Pressable
        onPress={() => navigation.navigate('CompararMercados')}
        accessibilityRole="button"
        hitSlop={8}
        style={({ pressed }) => [estilos.linkMercados, pressed && { opacity: 0.6 }]}
      >
        <Texto peso="semibold" tamanho="sm">
          Comparar mercados com esta lista →
        </Texto>
      </Pressable>

      <Texto cor="fraco" tamanho="xs" centralizado style={estilos.rodape}>
        Marque o que já está no carrinho e digite o preço da gôndola para conferir na hora.
      </Texto>

      <FolhaAdicionarItem
        visivel={adicionando}
        candidatos={produtos}
        jaNaLista={jaNaLista}
        aoAdicionar={(p) => void adicionar(p)}
        aoFechar={() => setAdicionando(false)}
      />

      <Dialogo
        visivel={removendo != null}
        titulo="Tirar da lista?"
        mensagem={`“${removendo?.nome ?? ''}” sai da sua lista de compras. O histórico de preços continua intacto.`}
        rotuloConfirmar="Tirar da lista"
        icone={<IconeLixeira tamanho={24} cor={c.caro} />}
        aoConfirmar={() => removendo && void remover(removendo)}
        aoCancelar={() => setRemovendo(null)}
      />
    </Tela>
  );
}

function ItemDaLista({
  item,
  tipico,
  precoTexto,
  ultima,
  aoMarcar,
  aoDigitarPreco,
  aoRemover,
}: {
  item: ItemLista;
  tipico?: TipicoRegional;
  precoTexto: string;
  ultima: boolean;
  aoMarcar: () => void;
  aoDigitarPreco: (texto: string) => void;
  aoRemover: () => void;
}) {
  const { c } = useTema();

  const digitado = parseMoeda(precoTexto);
  const veredito = digitado != null && tipico ? classificar(digitado, tipico.mediana) : null;

  const rotuloVeredito =
    veredito === 'abaixo'
      ? 'abaixo do típico'
      : veredito === 'acima'
        ? 'acima do típico'
        : 'na média';
  const corVeredito = veredito === 'abaixo' ? c.barato : veredito === 'acima' ? c.caro : c.medio;

  const sufixo = tipico ? `/${tipico.unidadeBase}` : '';

  return (
    <View style={[estilos.item, !ultima && { borderBottomWidth: 1, borderBottomColor: c.linha }]}>
      <Pressable
        onPress={aoMarcar}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.marcado }}
        accessibilityLabel={`${item.nome}, ${item.marcado ? 'no carrinho' : 'ainda não pego'}`}
        hitSlop={8}
        style={[
          estilos.caixa,
          {
            borderColor: item.marcado ? c.teal : c.borda,
            backgroundColor: item.marcado ? c.teal : 'transparent',
          },
        ]}
      >
        {item.marcado ? <IconeCheck tamanho={13} cor={c.sobreTeal} larguraTraco={3} /> : null}
      </Pressable>

      <Pressable
        onPress={aoRemover}
        onLongPress={aoRemover}
        accessibilityRole="button"
        accessibilityLabel={`Tirar ${item.nome} da lista`}
        style={estilos.itemTexto}
      >
        <Texto
          peso="semibold"
          tamanho="sm"
          numberOfLines={1}
          cor={item.marcado ? 'fraco' : 'tinta'}
          style={item.marcado ? estilos.riscado : undefined}
        >
          {item.nome}
        </Texto>
        <Texto cor="fraco" tamanho="xs" numerico>
          {tipico ? `típico ${moeda(tipico.mediana)}${sufixo}` : 'sem preço na sua região'}
        </Texto>
      </Pressable>

      <View style={estilos.itemDireita}>
        <View style={[estilos.campoPreco, { backgroundColor: c.superficie, borderColor: c.borda }]}>
          <Texto peso="semibold" cor="fraco" style={estilos.cifrao}>
            R$
          </Texto>
          <TextInput
            value={precoTexto}
            onChangeText={aoDigitarPreco}
            placeholder={tipico ? tipico.mediana.toFixed(2).replace('.', ',') : '0,00'}
            placeholderTextColor={c.fraco}
            keyboardType="decimal-pad"
            accessibilityLabel={`Preço de ${item.nome} na gôndola`}
            style={[estilos.inputPreco, { color: c.tinta }]}
          />
        </View>
        <Texto peso="semibold" numberOfLines={1} style={[estilos.veredito, { color: corVeredito }]}>
          {veredito ? rotuloVeredito : ' '}
        </Texto>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  contador: { fontSize: 11 },
  subtitulo: { marginTop: -espaco.md, marginBottom: espaco.lg },
  cartaoEstimativa: { marginBottom: espaco.md },
  estimativaTopo: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: espaco.sm,
  },
  melhorLoja: { fontSize: 11, flexShrink: 1, textAlign: 'right' },
  estimativaValor: { fontSize: 30, letterSpacing: -1.4, marginTop: espaco.xs, ...tabular },
  estimativaNota: { marginTop: 2 },
  gondolaLinha: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    marginTop: espaco.md,
    paddingTop: espaco.sm + 1,
  },
  aviso: { marginBottom: espaco.md, marginLeft: espaco.xs, lineHeight: 16 },
  lista: { marginBottom: espaco.md },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: 11,
    minHeight: 44,
  },
  caixa: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTexto: { flex: 1, minWidth: 0 },
  riscado: { textDecorationLine: 'line-through' },
  itemDireita: { alignItems: 'flex-end' },
  campoPreco: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 9,
  },
  cifrao: { fontSize: 11 },
  inputPreco: {
    width: 48,
    paddingVertical: 0,
    fontSize: 12.5,
    textAlign: 'right',
    ...tabular,
  },
  veredito: { fontSize: 9.5, marginTop: 3, minHeight: 12 },
  adicionar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm + 2,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: raio.cartao,
    padding: 13,
    minHeight: 44,
  },
  linkMercados: {
    marginTop: espaco.lg,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  adicionarTile: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rodape: { marginTop: espaco.sm, lineHeight: 16 },
  vazio: { marginTop: espaco.xl },
});
