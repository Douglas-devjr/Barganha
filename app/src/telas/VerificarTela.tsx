/**
 * C7.1/C7.2/C7.3 + Redesign "3a" — Verificar (o momento de valor, na gôndola).
 *
 * TELA ÚNICA, como o handoff: busca + chips + o card do veredito logo abaixo,
 * recalculando ao vivo. A diferença em relação ao protótipo é QUAL campo dispara
 * o recálculo: lá era o nome (cada produto do mock já trazia um preço "atual");
 * aqui é o PREÇO, porque o valor da gôndola só o usuário sabe — é justamente o
 * que ele veio conferir. O preço grande do card é o próprio input.
 *
 *  • Entrada do produto: código de barras (principal) + busca por nome (fallback).
 *  • Veredito resolvido do CACHE LOCAL primeiro (offline) e refinado online.
 *  • Promoção ("menor visto") sempre numa linha à parte — nunca colapsa no
 *    veredito (decisão travada; a inteligência mora em `@barganha/shared`).
 *
 * A escolha do produto é uma LISTA VERTICAL (o mesmo cartão-com-divisórias de
 * Produtos), não um carrossel de chips: com dezenas de itens o carrossel esconde
 * quase tudo fora da tela, corta nomes longos e obriga a arrastar de lado com o
 * carrinho na mão. A lista mostra nome + típico + nº de compras, e some assim
 * que o produto é escolhido — a tela passa a ser só o veredito, com "Trocar"
 * para voltar a escolher.
 */

import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { dadoRecente, type FaixaPreco, idadeEmDias, normalizarDescricao } from '@barganha/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  BarraPreco,
  Botao,
  CartaoLista,
  Estado,
  Eyebrow,
  FolhaDenuncia,
  IconeBandeira,
  IconeBarras,
  IconeBusca,
  IconeCheck,
  IconeChevron,
  IconeEtiqueta,
  IconeSino,
  Tela,
  Texto,
  TituloTela,
  VeredictoBadge,
  useToast,
} from '@/componentes';
import { clienteApi } from '@/api';
import { alertas } from '@/dados';
import { definirAlerta, removerAlerta } from '@/nucleo/alertas';
import * as catalogo from '@/nucleo/catalogo';
import type { ProdutoLocal } from '@/nucleo/catalogo';
import { idadeTexto, parseMoeda, vezesCompradas } from '@/nucleo/formato';
import { type LocalizacaoEfetiva, resolverLocalizacao } from '@/nucleo/localizacao';
import { usePermissaoNotificacao } from '@/nucleo/notificacoes-push';
import { consumirEanEscaneado } from '@/nucleo/scan-pendente';
import {
  refinarRegionalOnline,
  resolverVeredito,
  type ResultadoVeredito,
} from '@/nucleo/veredito-local';
import { espaco, raio, useTema } from '@/tema';
import type { RootStackParamList, TabParamList } from '@/navegacao/tipos';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Verificar'>,
  NativeStackScreenProps<RootStackParamList>
>;

function moeda(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',')}`;
}

/** Referências da régua a partir da faixa de destaque. */
function referencias(faixa: FaixaPreco, preco: number) {
  const mediana = faixa.mediana;
  const min =
    faixa.p25 ??
    (mediana != null ? mediana * 0.8 : Math.min(preco, faixa.menorPromocional ?? preco));
  const max = faixa.p75 ?? (mediana != null ? mediana * 1.2 : Math.max(preco, min * 1.4));
  const tipico =
    mediana ?? (faixa.p25 != null && faixa.p75 != null ? (faixa.p25 + faixa.p75) / 2 : preco);
  return { min, max, tipico };
}

export function VerificarTela({ navigation }: Props) {
  const { c } = useTema();
  const toast = useToast();
  const permissaoNotificacao = usePermissaoNotificacao();
  const [lista, setLista] = useState<ProdutoLocal[]>([]);
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<ProdutoLocal | null>(null);
  /** Volta para a lista com um produto já escolhido ("Trocar" / nova busca). */
  const [trocando, setTrocando] = useState(false);
  const [preco, setPreco] = useState('');
  const [resultado, setResultado] = useState<ResultadoVeredito | null>(null);
  const [refinando, setRefinando] = useState(false);
  /** Recorte geo ativo — rotula o card e acompanha a denúncia. */
  const [local, setLocal] = useState<LocalizacaoEfetiva | null>(null);
  const [alertaAtivo, setAlertaAtivo] = useState(false);
  const [sheetDenuncia, setSheetDenuncia] = useState(false);
  const montado = useRef(true);

  // Recarrega o catálogo e trata um EAN recém-escaneado a cada foco da aba.
  useFocusEffect(
    useCallback(() => {
      montado.current = true;
      void (async () => {
        const [todos, local] = await Promise.all([
          catalogo.carregarCatalogo(),
          resolverLocalizacao(),
        ]);
        if (!montado.current) return;
        setLista(todos);
        setLocal(local);

        const ean = consumirEanEscaneado();
        if (ean) {
          const achado = todos.find((p) => p.ean === ean);
          escolher(
            achado ?? {
              chave: `ean:${ean}`,
              produtoCanonicoId: null,
              ean,
              nome: 'Produto escaneado',
              unidadeBase: null,
              nObservacoes: 0,
            },
          );
        }
      })();
      return () => {
        montado.current = false;
      };
    }, []),
  );

  /** Troca o produto: limpa o veredito e busca a faixa regional em background. */
  function escolher(p: ProdutoLocal) {
    setSelecionado(p);
    setResultado(null);
    // O preço é da gôndola daquele item: herdá-lo no próximo produto daria um
    // veredito falso já na abertura do card.
    setPreco('');
    // Escolheu: a lista sai de cena e a busca zera para o próximo uso.
    setTrocando(false);
    setBusca('');
    void (async () => {
      if (p.produtoCanonicoId) {
        const existente = await alertas.obter(p.produtoCanonicoId);
        if (montado.current) setAlertaAtivo(existente != null);
      } else if (montado.current) {
        setAlertaAtivo(false);
      }

      setRefinando(true);
      try {
        await refinarRegionalOnline({ ean: p.ean, nome: p.nome });
      } finally {
        if (montado.current) setRefinando(false);
      }
    })();
  }

  const valor = parseMoeda(preco);

  // Recálculo AO VIVO: o veredito sai do cache local a cada dígito do preço.
  useEffect(() => {
    if (!selecionado || valor == null || valor <= 0) {
      setResultado(null);
      return;
    }
    let ativo = true;
    void resolverVeredito({
      precoPrateleira: valor,
      produtoCanonicoId: selecionado.produtoCanonicoId,
      ...(selecionado.faixaPessoal ? { faixaPessoal: selecionado.faixaPessoal } : {}),
    }).then((r) => {
      if (ativo && montado.current) setResultado(r);
    });
    return () => {
      ativo = false;
    };
  }, [selecionado, valor, refinando]);

  async function alternarAlerta() {
    const id = selecionado?.produtoCanonicoId;
    if (!id || !selecionado) return;
    if (alertaAtivo) {
      await removerAlerta(id);
      setAlertaAtivo(false);
      toast('Alerta de preço desativado');
      return;
    }
    // Alvo: o preço digitado, se houver; senão ~90% do típico (um alvo realista).
    const alvo = valor ?? (selecionado.faixaPessoal?.mediana ?? 0) * 0.9;
    if (alvo <= 0) return;
    const primeiroAlerta = (await alertas.listar()).length === 0;
    await definirAlerta(id, selecionado.nome, alvo);
    setAlertaAtivo(true);
    toast(`Avisamos quando baixar de ${moeda(alvo)}`);
    if (primeiroAlerta) permissaoNotificacao.solicitar();
  }

  const alvoBusca = normalizarDescricao(busca);
  const filtrados = alvoBusca
    ? lista.filter((p) => normalizarDescricao(p.nome).includes(alvoBusca))
    : lista;
  /** Modo escolha: sem produto selecionado, ou o usuário pediu para trocar. */
  const escolhendo = selecionado == null || trocando;

  const hibrido = resultado?.hibrido;
  const destaque = hibrido ? (hibrido.regional ?? hibrido.pessoal) : undefined;
  const faixaDestaque = destaque?.faixa;
  const base = faixaDestaque?.unidadeBase;
  const fmt = (v: number) => `${moeda(v)}${base ? `/${base}` : ''}`;

  /**
   * Idade do típico que está sendo exibido, e se ela ainda descreve a gôndola de
   * hoje (mesma regra da tela Comparar mercados — `dadoRecente`, do shared).
   *
   * A idade vem de `observadoEmMaisRecente`, nunca de `atualizadoEm`: no ângulo
   * REGIONAL aquele campo é o carimbo do recálculo no servidor, e um recálculo
   * geral deixaria um típico de meses atrás parecendo recém-saído do forno.
   */
  const idadeTipico = idadeEmDias(faixaDestaque?.observadoEmMaisRecente, new Date());
  const tipicoVelho =
    faixaDestaque != null && !dadoRecente(faixaDestaque.observadoEmMaisRecente, new Date());

  /** "13% abaixo do típico da sua região" — a mensagem sob o preço. */
  const mensagem = (() => {
    if (!hibrido || !destaque) return null;
    const tip = faixaDestaque?.mediana;
    const origem = hibrido.regional ? 'da sua região' : 'do seu histórico';
    // A engine se recusou a opinar (típico fora da janela da agregação): a tela
    // não pode inventar uma direção. Sem este ramo, o `!== 'na_media'` abaixo
    // levava `sem_dados` para o lado do "acima do típico" — afirmando justamente
    // o que a engine disse que não sabe.
    if (hibrido.veredito === 'sem_dados') {
      return tip != null
        ? `O típico ${origem} é antigo demais para comparar`
        : `Ainda sem base ${origem}`;
    }
    if (tip != null && hibrido.veredito !== 'na_media' && valor != null) {
      const d = Math.round((Math.abs(valor - tip) / tip) * 100);
      return `${d}% ${hibrido.veredito === 'barato' ? 'abaixo' : 'acima'} do típico ${origem}`;
    }
    return `Dentro da faixa típica ${origem}`;
  })();

  return (
    <Tela>
      <TituloTela titulo="Verificar preço" />
      <Texto cor="suave" style={estilos.subtitulo}>
        Compare com o típico da sua região antes de levar.
      </Texto>

      {/* busca com o scanner embutido à direita (padrão 3a) */}
      <View style={[estilos.busca, { backgroundColor: c.superficie, borderColor: c.borda }]}>
        <IconeBusca tamanho={18} cor={c.fraco} />
        <TextInput
          value={busca}
          onChangeText={(t) => {
            setBusca(t);
            // Digitar é pedir a lista de volta, mesmo com um produto aberto.
            if (t) setTrocando(true);
          }}
          placeholder="Buscar produto…"
          placeholderTextColor={c.fraco}
          style={[estilos.buscaInput, { color: c.tinta }]}
        />
        <Pressable
          onPress={() => navigation.navigate('EscanearBarras')}
          accessibilityRole="button"
          accessibilityLabel="Escanear código de barras"
          style={[estilos.botaoScan, { backgroundColor: c.tinta }]}
        >
          <IconeBarras tamanho={17} cor={c.sobreTeal} />
        </Pressable>
      </View>

      {escolhendo ? (
        lista.length === 0 ? (
          <View style={estilos.vazio}>
            <Estado
              icone={<IconeBarras tamanho={30} cor={c.tinta} />}
              titulo="Nenhum produto ainda"
              texto="Escaneie cupons para montar seu histórico — ou use o código de barras na gôndola."
              acao={{
                titulo: 'Escanear código de barras',
                onPress: () => navigation.navigate('EscanearBarras'),
              }}
            />
          </View>
        ) : filtrados.length === 0 ? (
          <View style={estilos.vazio}>
            <Estado
              icone={<IconeBusca tamanho={30} cor={c.tinta} />}
              titulo="Nada encontrado"
              texto="Nenhum produto seu bate com esta busca. Tente o código de barras da gôndola."
              acao={{ titulo: 'Limpar busca', onPress: () => setBusca(''), variante: 'secundario' }}
            />
          </View>
        ) : (
          <>
            <View style={estilos.cabecalhoLista}>
              <Eyebrow>{alvoBusca ? 'Resultados' : 'Seus produtos'}</Eyebrow>
              <Texto cor="fraco" tamanho="xs" numerico>
                {filtrados.length} {filtrados.length === 1 ? 'produto' : 'produtos'}
              </Texto>
            </View>
            <CartaoLista>
              {filtrados.map((p, idx) => (
                <ItemProduto
                  key={p.chave}
                  produto={p}
                  ativo={selecionado?.chave === p.chave}
                  ultima={idx === filtrados.length - 1}
                  aoTocar={() => escolher(p)}
                />
              ))}
            </CartaoLista>
          </>
        )
      ) : selecionado == null ? null : (
        <>
          {/* card do veredito ⭐ — o preço grande é o próprio input */}
          <View style={[estilos.painel, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }]}>
            <View style={estilos.painelTopo}>
              <Eyebrow style={{ flex: 1 }}>
                {[local?.municipio ?? local?.uf ?? null, base ? `por ${base}` : null, 'agora']
                  .filter(Boolean)
                  .join(' · ')}
              </Eyebrow>
              <View style={estilos.acoesTopo}>
                {/* Lançamento manual (C11.3): só cabe com um EAN real — nunca a
                    partir de um produto sem código de barras identificado, para
                    não mandar um lançamento sem como ancorar o produto. */}
                {selecionado.ean ? (
                  <Pressable
                    onPress={() =>
                      navigation.navigate('LancamentoManual', {
                        ean: selecionado.ean as string,
                        descricao: selecionado.nome,
                        unidadeBase: selecionado.unidadeBase,
                      })
                    }
                    accessibilityRole="button"
                    hitSlop={8}
                    style={estilos.denunciar}
                  >
                    <IconeEtiqueta tamanho={13} cor={c.fraco} />
                    <Texto cor="fraco" peso="semibold" style={estilos.denunciarTexto}>
                      Lançar preço
                    </Texto>
                  </Pressable>
                ) : null}
                {/* Só dá para denunciar o que a base conhece: a denúncia é
                    ancorada no produto canônico (C12.5). */}
                {selecionado.produtoCanonicoId ? (
                  <Pressable
                    onPress={() => setSheetDenuncia(true)}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={estilos.denunciar}
                  >
                    <IconeBandeira tamanho={13} cor={c.fraco} larguraTraco={2} />
                    <Texto cor="fraco" peso="semibold" style={estilos.denunciarTexto}>
                      Denunciar
                    </Texto>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={estilos.linhaNome}>
              <Texto peso="semibold" style={estilos.nomeProduto} numberOfLines={2}>
                {selecionado.nome}
              </Texto>
              {/* Sem catálogo (produto só escaneado), voltar à lista levaria a
                  um vazio sem saída — o "Trocar" só existe com o que escolher. */}
              {lista.length > 0 ? (
                <Pressable
                  onPress={() => setTrocando(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Trocar de produto"
                  hitSlop={8}
                  style={({ pressed }) => [estilos.trocar, pressed && { opacity: 0.6 }]}
                >
                  <Texto tamanho="sm" peso="bold" style={{ color: c.tinta }}>
                    Trocar
                  </Texto>
                </Pressable>
              ) : null}
            </View>

            <View style={estilos.linhaPreco}>
              <View style={estilos.campoPreco}>
                <Texto peso="bold" cor="fraco" style={estilos.cifrao}>
                  R$
                </Texto>
                <TextInput
                  value={preco}
                  onChangeText={setPreco}
                  inputMode="decimal"
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  placeholderTextColor={c.fraco}
                  accessibilityLabel="Preço visto na prateleira"
                  style={[estilos.precoInput, { color: c.tinta }]}
                />
              </View>
              {hibrido ? (
                <VeredictoBadge
                  veredito={hibrido.veredito}
                  poucosDados={destaque?.poucosDados ?? false}
                  dadoVelho={destaque?.dadoVelho ?? false}
                />
              ) : null}
            </View>

            <Texto cor="suave" style={estilos.mensagem}>
              {mensagem ??
                (resultado?.semDados
                  ? 'Ainda sem base para opinar na sua região.'
                  : 'Digite o preço da prateleira para comparar.')}
            </Texto>

            {/*
              Sem veredito, sem régua: a barra POSICIONA o preço contra a faixa, o
              que é a mesma afirmação que a engine acabou de recusar. Desenhá-la sob
              a frase "o típico é antigo demais para comparar" seria desmenti-la.
            */}
            {faixaDestaque && valor != null && hibrido?.veredito !== 'sem_dados' ? (
              <View style={{ marginTop: espaco.lg }}>
                {(() => {
                  const r = referencias(faixaDestaque, valor);
                  return (
                    <BarraPreco
                      preco={valor}
                      min={r.min}
                      max={r.max}
                      tipico={r.tipico}
                      formatar={fmt}
                    />
                  );
                })()}
              </View>
            ) : null}

            {/* promoção nunca entra no veredito — linha à parte (decisão travada) */}
            {hibrido?.promocao ? (
              <View style={[estilos.promo, { backgroundColor: c.ambarBg }]}>
                <View style={[estilos.pontoPromo, { backgroundColor: c.ambar }]} />
                <Texto tamanho="sm" peso="bold" style={{ flex: 1, color: c.ambarTexto }}>
                  Menor visto (promoção)
                </Texto>
                <Texto peso="bold" numerico style={{ color: c.ambarTexto }}>
                  {moeda(hibrido.promocao.menorVisto)}
                  {hibrido.promocao.unidadeBase ? `/${hibrido.promocao.unidadeBase}` : ''}
                </Texto>
              </View>
            ) : null}

            {/*
              Rodapé = a EVIDÊNCIA do veredito: quantos cupons o sustentam e de
              quando é o preço mais novo deles. Sem a idade, um típico de abril e
              um de ontem apareciam idênticos — e é o de abril que faz a pessoa
              chegar na gôndola e a conta não bater.
            */}
            <Texto
              cor={tipicoVelho ? 'suave' : 'fraco'}
              numerico
              style={[estilos.rodape, { borderTopColor: c.cartaoBorda }]}
            >
              {refinando
                ? 'Buscando preços da sua região…'
                : hibrido?.regional
                  ? `${hibrido.regional.faixa.nObservacoes} ${
                      hibrido.regional.faixa.nObservacoes === 1 ? 'cupom' : 'cupons'
                    } na sua região · típico ${idadeTexto(idadeTipico)}${
                      tipicoVelho ? ' — confira na gôndola' : ''
                    }`
                  : hibrido?.pessoal
                    ? `Base do seu histórico (última compra ${idadeTexto(idadeTipico)}) — ainda sem preços da sua região`
                    : 'Sem base regional ainda'}
            </Texto>
          </View>

          {selecionado.nObservacoes > 0 ? (
            <Pressable
              onPress={() =>
                navigation.navigate('ProdutoDetalhe', {
                  chave: selecionado.chave,
                  nome: selecionado.nome,
                })
              }
              accessibilityRole="button"
              style={estilos.verHistorico}
            >
              <Texto peso="semibold" tamanho="sm" style={estilos.link}>
                Ver histórico e onde comprar →
              </Texto>
            </Pressable>
          ) : null}

          {selecionado.produtoCanonicoId ? (
            <Botao
              titulo={alertaAtivo ? 'Avisar quando baixar · ativo' : 'Avisar quando baixar'}
              variante={alertaAtivo ? 'secundario' : 'primario'}
              bloco
              icone={<IconeSino tamanho={17} cor={alertaAtivo ? c.tinta : c.sobreTeal} />}
              onPress={() => void alternarAlerta()}
              style={{ marginTop: espaco.md }}
            />
          ) : null}
        </>
      )}

      <FolhaDenuncia
        visivel={sheetDenuncia}
        produto={selecionado?.nome ?? ''}
        aoFechar={() => setSheetDenuncia(false)}
        aoEnviar={async (motivo) => {
          const id = selecionado?.produtoCanonicoId;
          if (!id) return;
          const r = await clienteApi.denunciarPreco({
            produtoCanonicoId: id,
            motivo,
            ...(local?.municipio ? { municipio: local.municipio } : {}),
            ...(local?.uf ? { uf: local.uf } : {}),
          });
          setSheetDenuncia(false);
          toast(r.jaRegistrada ? 'Você já tinha denunciado este preço' : 'Denúncia enviada');
        }}
      />
    </Tela>
  );
}

/**
 * Linha da lista de escolha. Traz o típico PESSOAL e quantas compras o
 * sustentam, para o usuário reconhecer o item antes de tocar — o veredito
 * regional só aparece depois, com o preço da gôndola digitado.
 *
 * O típico mora numa COLUNA à direita, sob o rótulo "seu típico", e a contagem
 * de compras vira frase sob o nome. Antes os dois dividiam uma única linha de
 * 11,5px separados por "·" ("típico R$ 5,49/L · 3 compras"), e o preço colado à
 * contagem se lia como quantidade do produto: 3 unidades por R$ 5,49. São dois
 * fatos de naturezas diferentes — um preço e a evidência dele —, então cada um
 * fica no seu lugar, e só o preço ocupa a posição de valor.
 */
function ItemProduto({
  produto,
  ativo,
  ultima,
  aoTocar,
}: {
  produto: ProdutoLocal;
  ativo: boolean;
  ultima: boolean;
  aoTocar: () => void;
}) {
  const { c } = useTema();
  const tipico = produto.faixaPessoal?.mediana;
  const sufixo = produto.unidadeBase ? `/${produto.unidadeBase}` : '';

  return (
    <Pressable
      onPress={aoTocar}
      accessibilityRole="button"
      accessibilityState={ativo ? { selected: true } : {}}
      accessibilityLabel={
        tipico != null
          ? `${produto.nome}, seu típico ${moeda(tipico)}${sufixo}, ${vezesCompradas(produto.nObservacoes)}`
          : `${produto.nome}, ${vezesCompradas(produto.nObservacoes)}`
      }
      style={({ pressed }) => [
        estilos.item,
        !ultima && { borderBottomWidth: 1, borderBottomColor: c.linha },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={estilos.itemTexto}>
        <Texto peso={ativo ? 'bold' : 'semibold'} tamanho="sm" numberOfLines={1}>
          {produto.nome}
        </Texto>
        <Texto cor="fraco" numerico style={estilos.itemSub}>
          {vezesCompradas(produto.nObservacoes)}
        </Texto>
      </View>
      {tipico != null ? (
        <View style={estilos.itemValor}>
          <Texto cor="fraco" style={estilos.itemRotulo}>
            seu típico
          </Texto>
          <Texto peso="bold" tamanho="sm" numerico style={estilos.itemTipico}>
            {`${moeda(tipico)}${sufixo}`}
          </Texto>
        </View>
      ) : null}
      {ativo ? (
        <IconeCheck tamanho={18} cor={c.tinta} />
      ) : (
        <IconeChevron tamanho={16} cor={c.fraco} />
      )}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  subtitulo: { fontSize: 13, marginTop: 4, marginBottom: 14 },
  busca: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: raio.md,
    paddingLeft: 14,
    paddingRight: 7,
  },
  buscaInput: { flex: 1, paddingVertical: 0, fontSize: 13.5 },
  botaoScan: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cabecalhoLista: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
    marginTop: espaco.lg,
    marginBottom: espaco.sm,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, paddingVertical: 13 },
  itemTexto: { flex: 1 },
  itemSub: { fontSize: 11.5, marginTop: 2 },
  /** Coluna do valor: o preço alinhado à direita, sob o rótulo que o nomeia. */
  itemValor: { alignItems: 'flex-end' },
  itemRotulo: { fontSize: 10 },
  itemTipico: { marginTop: 1 },
  vazio: { marginTop: espaco.lg },
  painel: {
    borderRadius: raio.cartao,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    marginTop: espaco.lg,
  },
  painelTopo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  acoesTopo: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  denunciar: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 24 },
  denunciarTexto: { fontSize: 11 },
  linhaNome: { flexDirection: 'row', alignItems: 'flex-start', gap: espaco.sm, marginTop: 10 },
  nomeProduto: { flex: 1, fontSize: 15 },
  trocar: { minHeight: 24, justifyContent: 'center' },
  linhaPreco: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 2,
  },
  campoPreco: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 1 },
  cifrao: { fontSize: 26, letterSpacing: -1 },
  // "preço médio" do 3a: 36/700/-1.8, tabular
  precoInput: {
    minWidth: 110,
    padding: 0,
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -1.8,
    fontVariant: ['tabular-nums'],
  },
  mensagem: { fontSize: 12.5, marginTop: 2 },
  promo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    marginTop: espaco.md,
  },
  pontoPromo: { width: 8, height: 8, borderRadius: 4 },
  rodape: { fontSize: 10.5, borderTopWidth: 1, marginTop: espaco.md, paddingTop: 9 },
  verHistorico: { minHeight: 44, justifyContent: 'center', marginTop: espaco.sm },
  link: { textDecorationLine: 'underline' },
});
