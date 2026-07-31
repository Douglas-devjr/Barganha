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
 * digitado NÃO persiste: é da ida ao mercado, envelhece em horas. A quantidade
 * persiste e multiplica tudo — estimativa, "na gôndola" e a cesta que vai ao
 * ranking por loja: quem leva 5 caixas de leite precisa do total de 5, não de 1.
 *
 * Tudo offline: a lista é local e os típicos vêm do `cache_estatistica` baixado
 * pelo delta sync. Só o ranking por loja ("no Assaí sai por…") precisa de rede,
 * e a ausência dele não impede nada.
 */

import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { classificarPreco, dadoRecente, idadeEmDias } from '@barganha/shared';

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
import { idadeTexto, moeda, parseMoeda } from '@/nucleo/formato';
import { resolverLocalizacao } from '@/nucleo/localizacao';
import { sincronizarEstatisticas } from '@/nucleo/sincronizador';
import { tipicosDaRegiao, type TipicoRegional } from '@/nucleo/tipico-regional';
import { espaco, raio, tabular, useTema } from '@/tema';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Lista'>,
  NativeStackScreenProps<RootStackParamList>
>;

type Veredito = 'abaixo' | 'media' | 'acima' | 'sem_veredito';

/**
 * Veredito do preço da gôndola contra o típico — pela engine de
 * `@barganha/shared`, a MESMA da Verificar.
 *
 * Antes esta tela tinha a sua própria tolerância de ±5% copiada. A cópia não
 * conhecia a zona morta que cresce com a idade do dado nem a janela da agregação,
 * então o mesmo produto pelo mesmo preço podia sair "abaixo do típico" aqui e "na
 * média" na Verificar, no mesmo minuto — sem nada no log para explicar.
 *
 * A faixa daqui não tem percentis (o cache regional resolvido traz a mediana), e
 * a engine trata esse caso: a zona morta decide o lado.
 */
function classificar(preco: number, tipico: TipicoRegional, referencia: Date): Veredito {
  const v = classificarPreco(
    preco,
    {
      mediana: tipico.mediana,
      nObservacoes: tipico.nObservacoes,
      unidadeBase: tipico.unidadeBase,
      atualizadoEm: tipico.atualizadoEm,
      ...(tipico.observadoEmMaisRecente
        ? { observadoEmMaisRecente: tipico.observadoEmMaisRecente }
        : {}),
    },
    referencia,
  );
  if (v === 'barato') return 'abaixo';
  if (v === 'caro') return 'acima';
  if (v === 'na_media') return 'media';
  // 'sem_dados' — típico fora da janela da agregação: sem rótulo, e o item mostra
  // a idade ao lado do nome dizendo por quê.
  return 'sem_veredito';
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
  const [limpando, setLimpando] = useState(false);
  /** Total da cesta na loja mais barata da região; `null` = sem rede/sem dado. */
  const [melhorLoja, setMelhorLoja] = useState<{ nome: string; total: number } | null>(null);
  /**
   * Sequência do pedido de ranking em voo. Mexer na quantidade dispara um pedido
   * por toque, e cinco toques rápidos no "+" viram cinco pedidos: sem isto, uma
   * resposta antiga chegando depois da nova estampa o total de 3 caixas embaixo
   * de uma lista que já tem 5.
   */
  const pedidoLoja = useRef(0);

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
    const meu = ++pedidoLoja.current;
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
      if (meu !== pedidoLoja.current) return; // resposta velha: a cesta já mudou
      const primeira = r.lojas[0];
      // Só vale como "sai por" se a loja cobre a lista inteira; cobertura
      // parcial daria um total menor por FALTA de itens, não por ser barata.
      //
      // E só com dado RECENTE — a mesma trava do selo da tela Comparar mercados
      // (`dadoRecente`). Sem isto esta linha afirmaria "no Assaí sai por R$ 180"
      // com preço de meses atrás enquanto a outra tela, olhando os mesmos dados,
      // se recusa a recomendar a loja.
      setMelhorLoja(
        primeira &&
          primeira.itensCobertos === r.itensTotal &&
          dadoRecente(primeira.observadoEmMaisAntigo, new Date())
          ? { nome: primeira.nome ?? 'mercado da região', total: primeira.total }
          : null,
      );
    } catch {
      if (meu === pedidoLoja.current) setMelhorLoja(null);
    }
  }, []);

  // A MESMA cesta que a tela Comparar mercados usa: a lista menos o que foi
  // excluído da comparação (`fora_comparacao`, v9). Sem esse recorte as duas
  // telas mostrariam totais diferentes — e às vezes vencedores diferentes —
  // para a mesma pessoa no mesmo minuto.
  useFocusEffect(
    useCallback(() => {
      if (itens) void buscarMelhorLoja(listaRepo.cestaComparavel(itens));
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
   * Quantidade — otimista como o `marcado`: o toque tem de responder no dedo, e o
   * banco local é a cópia, não a fonte da tela. O piso é 1 (`definirQuantidade`
   * também garante); para zerar existe tirar da lista. O teto de 99 é só contra o
   * dedo preso no "+".
   */
  async function mudarQuantidade(item: ItemLista, delta: number) {
    const nova = Math.max(1, Math.min(99, item.quantidade + delta));
    if (nova === item.quantidade) return;
    setItens(
      (atual) =>
        atual?.map((i) =>
          i.produtoCanonicoId === item.produtoCanonicoId ? { ...i, quantidade: nova } : i,
        ) ?? null,
    );
    await listaRepo.definirQuantidade(item.produtoCanonicoId, nova);
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

  /**
   * Esvaziar a lista inteira — a saída para quem terminou a compra e vai montar
   * a próxima. Sempre passa pelo diálogo: é destrutivo e não tem desfazer.
   */
  async function limparTudo() {
    const quantos = itens?.length ?? 0;
    await listaRepo.removerTodos();
    setLimpando(false);
    // Os preços digitados eram daquela ida ao mercado; deixá-los aqui faria o
    // "na gôndola até agora" ressuscitar no primeiro item da lista seguinte.
    setPrecos({});
    await recarregar();
    toast(quantos === 1 ? 'A lista está vazia' : `${quantos} itens saíram da lista`);
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
          <View style={estilos.tituloAcoes}>
            <Texto peso="semibold" cor="suave" numerico style={estilos.contador}>
              {itens.length} {itens.length === 1 ? 'item' : 'itens'}
            </Texto>
            <Pressable
              onPress={() => setLimpando(true)}
              accessibilityRole="button"
              accessibilityLabel="Limpar a lista de compras"
              hitSlop={12}
              style={({ pressed }) => [estilos.limpar, pressed && { opacity: 0.6 }]}
            >
              <IconeLixeira tamanho={13} cor={c.fraco} />
              <Texto peso="semibold" cor="suave" style={estilos.limparTexto}>
                Limpar
              </Texto>
            </Pressable>
          </View>
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
            aoMudarQuantidade={(delta) => void mudarQuantidade(item, delta)}
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

      <Dialogo
        visivel={limpando}
        titulo="Limpar a lista?"
        mensagem={
          (itens.length === 1
            ? 'O item sai da sua lista de compras. '
            : `Os ${itens.length} itens saem da sua lista de compras de uma vez. `) +
          'O histórico de preços continua intacto.'
        }
        rotuloConfirmar="Limpar lista"
        icone={<IconeLixeira tamanho={24} cor={c.caro} />}
        aoConfirmar={() => void limparTudo()}
        aoCancelar={() => setLimpando(false)}
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
  aoMudarQuantidade,
  aoDigitarPreco,
  aoRemover,
}: {
  item: ItemLista;
  tipico?: TipicoRegional;
  precoTexto: string;
  ultima: boolean;
  aoMarcar: () => void;
  aoMudarQuantidade: (delta: number) => void;
  aoDigitarPreco: (texto: string) => void;
  aoRemover: () => void;
}) {
  const { c } = useTema();

  // Um "agora" por item: as duas leituras de idade abaixo têm de concordar.
  const agora = new Date();
  const digitado = parseMoeda(precoTexto);
  const veredito = digitado != null && tipico ? classificar(digitado, tipico, agora) : null;

  const rotuloVeredito =
    veredito === 'abaixo'
      ? 'abaixo do típico'
      : veredito === 'acima'
        ? 'acima do típico'
        : veredito === 'sem_veredito'
          ? 'sem base atual'
          : 'na média';
  const corVeredito =
    veredito === 'abaixo'
      ? c.barato
      : veredito === 'acima'
        ? c.caro
        : veredito === 'sem_veredito'
          ? c.fraco
          : c.medio;

  const sufixo = tipico ? `/${tipico.unidadeBase}` : '';

  /**
   * A idade só aparece quando o típico está VELHO. Estampar "há 3 dias" em cada
   * item da lista inteira viraria ruído e ninguém leria mais nada; a exceção é o
   * que precisa de atenção — é contra esse típico que o veredito da gôndola ao
   * lado está sendo dado.
   */
  const tipicoVelho = tipico != null && !dadoRecente(tipico.observadoEmMaisRecente, agora);
  const idade = idadeTexto(idadeEmDias(tipico?.observadoEmMaisRecente, agora));

  /**
   * Subtotal do item: preço da gôndola × quantidade. Só aparece com quantidade
   * acima de 1 — com 1 unidade ele repetiria o número que está no campo ao lado.
   *
   * Quando aparece, ele TOMA o lugar do "típico R$ x/kg" nesta linha em vez de
   * disputar largura com ele: quem já digitou o preço tem o veredito ao lado
   * dizendo se está bom, e o que falta saber é quanto vai sair no caixa.
   */
  const subtotal = digitado != null && item.quantidade > 1 ? digitado * item.quantidade : null;

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

      <View style={estilos.itemTexto}>
        <Pressable
          onPress={aoRemover}
          onLongPress={aoRemover}
          accessibilityRole="button"
          accessibilityLabel={`Tirar ${item.nome} da lista`}
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
        </Pressable>

        <View style={estilos.linhaQuantidade}>
          <PassoQuantidade
            nome={item.nome}
            quantidade={item.quantidade}
            aoMudar={aoMudarQuantidade}
          />
          <Texto
            peso={subtotal != null ? 'semibold' : 'medium'}
            cor={subtotal != null ? 'tinta' : tipicoVelho ? 'suave' : 'fraco'}
            tamanho="xs"
            numerico
            numberOfLines={1}
            style={estilos.subinfo}
          >
            {subtotal != null
              ? `= ${moeda(subtotal)}`
              : tipico
                ? `típico ${moeda(tipico.mediana)}${sufixo}${tipicoVelho ? ` · ${idade}` : ''}`
                : 'sem preço na região'}
          </Texto>
        </View>
      </View>

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

/**
 * Stepper de quantidade — o que faz o total da lista ser o total da COMPRA.
 *
 * Mora na segunda linha do item, e não ao lado do campo de preço, por largura: os
 * dois na mesma linha comprimiriam o nome do produto a ~100dp, e nome de produto
 * cortado numa lista de compras é pior do que um toque a mais.
 *
 * No 1 o "−" fica apagado e inerte: para zerar existe tirar da lista (toque no
 * nome). Um "−" que às vezes apaga o item seria uma armadilha.
 */
function PassoQuantidade({
  nome,
  quantidade,
  aoMudar,
}: {
  nome: string;
  quantidade: number;
  aoMudar: (delta: number) => void;
}) {
  const { c } = useTema();
  const noPiso = quantidade <= 1;
  // Os dois botões têm 22px de lado, abaixo dos 44 de alvo mínimo: o hitSlop
  // completa. Só 6px na horizontal para as duas áreas não se encostarem no meio.
  const alvo = { top: 11, bottom: 11, left: 6, right: 6 };

  return (
    <View style={estilos.passo}>
      <Pressable
        onPress={() => aoMudar(-1)}
        disabled={noPiso}
        accessibilityRole="button"
        accessibilityLabel={`Diminuir a quantidade de ${nome}`}
        accessibilityState={{ disabled: noPiso }}
        hitSlop={alvo}
        style={({ pressed }) => [
          estilos.passoBotao,
          { borderColor: c.borda },
          noPiso && { opacity: 0.35 },
          pressed && !noPiso && { backgroundColor: c.linha },
        ]}
      >
        <Texto peso="semibold" cor="suave" style={estilos.passoSinal}>
          −
        </Texto>
      </Pressable>

      <Texto
        peso="bold"
        numerico
        centralizado
        accessibilityLabel={`Quantidade: ${quantidade}`}
        style={estilos.passoValor}
      >
        {quantidade}
      </Texto>

      <Pressable
        onPress={() => aoMudar(1)}
        accessibilityRole="button"
        accessibilityLabel={`Aumentar a quantidade de ${nome}`}
        hitSlop={alvo}
        style={({ pressed }) => [
          estilos.passoBotao,
          { borderColor: c.borda },
          pressed && { backgroundColor: c.linha },
        ]}
      >
        <Texto peso="semibold" cor="suave" style={estilos.passoSinal}>
          +
        </Texto>
      </Pressable>
    </View>
  );
}

const estilos = StyleSheet.create({
  tituloAcoes: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  contador: { fontSize: 11 },
  limpar: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  limparTexto: { fontSize: 12 },
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
  linhaQuantidade: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, marginTop: 4 },
  subinfo: { flexShrink: 1 },
  passo: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  passoBotao: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passoSinal: { fontSize: 14, lineHeight: 17 },
  passoValor: { minWidth: 18, fontSize: 12.5 },
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
