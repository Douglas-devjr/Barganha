/**
 * C7.4 + Redesign "3a" — Produtos. Estrutura do protótipo: título + contagem de
 * monitorados, linha de busca (46px) com botão de filtro (badge do nº de
 * filtros ativos), skeleton shimmer enquanto o catálogo carrega e a lista em
 * cartão único com divisórias.
 *
 * Cada item: nome + "seu típico R$ x" + "comprou N vezes", último preço à
 * direita e o indicador de variação (seta para baixo em `barato`, para cima em
 * `caro`, "na média" em `medio`). O kebab abre o sheet de ações.
 *
 * O típico e a contagem ficam em LINHAS SEPARADAS. Juntos numa só ("típico
 * R$ 5,49/L · 3 compras") o preço colava na contagem e virava quantidade do
 * produto aos olhos de quem lê — 3 unidades por R$ 5,49. A contagem é a
 * evidência do típico, não um número do rótulo da gôndola.
 *
 * A ordenação por preço usa a mediana PESSOAL; produto sem faixa vai para o fim
 * — não fingimos que custa zero.
 */

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  CabecalhoVoltar,
  CartaoLista,
  Dialogo,
  Esqueleto,
  Estado,
  Eyebrow,
  FolhaDenuncia,
  FolhaInferior,
  IconeBusca,
  IconeCheck,
  IconeFiltro,
  IconeKebab,
  IconeLixeira,
  IconeProdutos,
  IconeTendenciaBaixo,
  IconeTendenciaCima,
  LinhaFolha,
  Tela,
  Texto,
  useToast,
} from '@/componentes';
import { clienteApi } from '@/api';
import { lista as listaCompras } from '@/dados';
import * as catalogo from '@/nucleo/catalogo';
import { vezesCompradas } from '@/nucleo/formato';
import { resolverLocalizacao } from '@/nucleo/localizacao';
import { comPiso } from '@/nucleo/ritmo';
import type { ProdutoLocal } from '@/nucleo/catalogo';
import { espaco, raio, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'Produtos'>;

function moeda(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',')}`;
}

// Abaixo de 2% de variação, a tendência é tratada como estável.
const LIMIAR_ESTAVEL = 2;

type Ordem = 'padrao' | 'menor' | 'maior' | 'az';

const ORDENS: { chave: Ordem; rotulo: string }[] = [
  { chave: 'padrao', rotulo: 'Padrão' },
  { chave: 'menor', rotulo: 'Menor preço' },
  { chave: 'maior', rotulo: 'Maior preço' },
  { chave: 'az', rotulo: 'A–Z' },
];

function ordenar(itens: ProdutoLocal[], ordem: Ordem): ProdutoLocal[] {
  if (ordem === 'padrao') return itens;
  const copia = [...itens];
  if (ordem === 'az') return copia.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  // Sem mediana pessoal não há preço para comparar: vai para o fim nos dois
  // sentidos (Infinity/-Infinity conforme a direção).
  const semDado = ordem === 'menor' ? Infinity : -Infinity;
  return copia.sort((a, b) => {
    const pa = a.faixaPessoal?.mediana ?? semDado;
    const pb = b.faixaPessoal?.mediana ?? semDado;
    return ordem === 'menor' ? pa - pb : pb - pa;
  });
}

export function ProdutosTela({ navigation }: Props) {
  const { c } = useTema();
  const toast = useToast();
  const [itens, setItens] = useState<ProdutoLocal[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('padrao');
  const [sheetFiltros, setSheetFiltros] = useState(false);
  const [sel, setSel] = useState<ProdutoLocal | null>(null);
  const [confirmando, setConfirmando] = useState<ProdutoLocal | null>(null);
  const [denunciando, setDenunciando] = useState<ProdutoLocal | null>(null);
  const montado = useRef(true);
  /** Só a primeira carga mostra esqueleto — nas voltas o dado já está na tela. */
  const primeiraCarga = useRef(true);

  useFocusEffect(
    useCallback(() => {
      montado.current = true;
      void (async () => {
        const leitura = catalogo.carregarCatalogo();
        const todos = primeiraCarga.current ? await comPiso(leitura) : await leitura;
        if (!montado.current) return;
        primeiraCarga.current = false;
        setItens(todos);
        setCarregando(false);
      })();
      return () => {
        montado.current = false;
      };
    }, []),
  );

  const filtrados = ordenar(
    busca ? itens.filter((p) => p.nome.toLowerCase().includes(busca.toLowerCase())) : itens,
    ordem,
  );
  const filtrosAtivos = ordem === 'padrao' ? 0 : 1;

  function abrirEdicao(p: ProdutoLocal) {
    setSel(null);
    navigation.navigate('EditarProduto', {
      nome: p.nome,
      produtoCanonicoId: p.produtoCanonicoId,
      unidadeBase: p.unidadeBase ?? null,
    });
  }

  async function removerDaLista(p: ProdutoLocal) {
    if (p.produtoCanonicoId) await listaCompras.remover(p.produtoCanonicoId);
    setConfirmando(null);
    toast('Removido da lista');
  }

  return (
    <Tela>
      <CabecalhoVoltar
        titulo="Produtos"
        subtitulo={
          !carregando
            ? `${itens.length} ${itens.length === 1 ? 'monitorado' : 'monitorados'}`
            : undefined
        }
        aoVoltar={() => navigation.goBack()}
      />

      <View style={estilos.linhaBusca}>
        <View style={[estilos.busca, { backgroundColor: c.superficie, borderColor: c.borda }]}>
          <IconeBusca tamanho={18} cor={c.fraco} />
          <TextInput
            value={busca}
            onChangeText={setBusca}
            placeholder="Buscar nos seus produtos"
            placeholderTextColor={c.fraco}
            style={[estilos.buscaInput, { color: c.tinta }]}
          />
        </View>
        <Pressable
          onPress={() => setSheetFiltros(true)}
          accessibilityRole="button"
          accessibilityLabel="Filtrar e ordenar"
          style={[estilos.botaoFiltro, { backgroundColor: c.cartao, borderColor: c.borda }]}
        >
          <IconeFiltro tamanho={19} cor={c.tinta} />
          {filtrosAtivos > 0 ? (
            <View style={[estilos.badge, { backgroundColor: c.tinta }]}>
              <Texto peso="bold" cor="sobreTeal" style={estilos.badgeTexto}>
                {filtrosAtivos}
              </Texto>
            </View>
          ) : null}
        </Pressable>
      </View>

      {carregando ? (
        <EsqueletoLista />
      ) : filtrados.length === 0 ? (
        <View style={estilos.vazio}>
          {itens.length === 0 ? (
            <Estado
              icone={<IconeProdutos tamanho={30} cor={c.tinta} />}
              titulo="Nenhum produto ainda"
              texto="Seus produtos aparecem aqui conforme você escaneia cupons."
            />
          ) : (
            <Estado
              icone={<IconeBusca tamanho={30} cor={c.tinta} />}
              titulo="Nada encontrado"
              texto="Nenhum produto bate com esta busca."
              acao={{ titulo: 'Limpar busca', onPress: () => setBusca(''), variante: 'secundario' }}
            />
          )}
        </View>
      ) : (
        <CartaoLista style={estilos.lista}>
          {filtrados.map((p, idx) => (
            <ProdutoItem
              key={p.chave}
              produto={p}
              ultima={idx === filtrados.length - 1}
              aoTocar={() =>
                navigation.navigate('ProdutoDetalhe', { chave: p.chave, nome: p.nome })
              }
              aoAbrirAcoes={() => setSel(p)}
            />
          ))}
        </CartaoLista>
      )}

      <FolhaInferior visivel={sel != null} titulo={sel?.nome ?? ''} aoFechar={() => setSel(null)}>
        <LinhaFolha rotulo="Editar produto" onPress={() => sel && abrirEdicao(sel)} />
        <LinhaFolha
          rotulo="Ver histórico"
          onPress={() => {
            const p = sel;
            setSel(null);
            if (p) navigation.navigate('ProdutoDetalhe', { chave: p.chave, nome: p.nome });
          }}
        />
        {/* A denúncia é ancorada no produto canônico (C12.5): sem ele, não há
            o que a curadoria revisar. */}
        {sel?.produtoCanonicoId ? (
          <LinhaFolha
            rotulo="Denunciar preço incorreto"
            onPress={() => {
              const p = sel;
              setSel(null);
              setDenunciando(p);
            }}
          />
        ) : null}
        <LinhaFolha
          rotulo="Excluir da lista"
          destrutiva
          comBorda={false}
          onPress={() => {
            const p = sel;
            setSel(null);
            if (p) setConfirmando(p);
          }}
        />
      </FolhaInferior>

      <FolhaDenuncia
        visivel={denunciando != null}
        produto={denunciando?.nome ?? ''}
        aoFechar={() => setDenunciando(null)}
        aoEnviar={async (motivo) => {
          const id = denunciando?.produtoCanonicoId;
          if (!id) return;
          const local = await resolverLocalizacao();
          const r = await clienteApi.denunciarPreco({
            produtoCanonicoId: id,
            motivo,
            ...(local?.municipio ? { municipio: local.municipio } : {}),
            ...(local?.uf ? { uf: local.uf } : {}),
          });
          setDenunciando(null);
          toast(r.jaRegistrada ? 'Você já tinha denunciado este preço' : 'Denúncia enviada');
        }}
      />

      <FolhaInferior
        visivel={sheetFiltros}
        titulo="Filtrar e ordenar"
        acaoTitulo={{ rotulo: 'Limpar', onPress: () => setOrdem('padrao') }}
        aoFechar={() => setSheetFiltros(false)}
        rotuloFechar="Ver resultados"
      >
        <Eyebrow style={{ marginBottom: espaco.xs }}>Ordenar por</Eyebrow>
        {ORDENS.map((o, idx) => (
          <Pressable
            key={o.chave}
            onPress={() => setOrdem(o.chave)}
            accessibilityRole="button"
            accessibilityState={ordem === o.chave ? { selected: true } : {}}
            style={[
              estilos.linhaOrdem,
              idx < ORDENS.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.linha },
            ]}
          >
            <Texto peso={ordem === o.chave ? 'bold' : 'medium'} style={{ flex: 1 }}>
              {o.rotulo}
            </Texto>
            {ordem === o.chave ? <IconeCheck tamanho={18} cor={c.tinta} /> : null}
          </Pressable>
        ))}
      </FolhaInferior>

      <Dialogo
        visivel={confirmando != null}
        titulo="Excluir da lista?"
        mensagem={`"${confirmando?.nome ?? ''}" sai da sua lista de compras. O histórico de preços continua intacto.`}
        rotuloConfirmar="Excluir"
        icone={<IconeLixeira tamanho={24} cor={c.caro} />}
        aoConfirmar={() => confirmando && void removerDaLista(confirmando)}
        aoCancelar={() => setConfirmando(null)}
      />
    </Tela>
  );
}

/** 5 linhas em shimmer enquanto o catálogo carrega (padrão do protótipo). */
function EsqueletoLista() {
  const { c } = useTema();
  return (
    <CartaoLista style={estilos.lista}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={[
            estilos.linhaEsqueleto,
            i < 4 && { borderBottomWidth: 1, borderBottomColor: c.linha },
          ]}
        >
          {/* três barras porque a linha real tem três textos (nome, típico,
              "comprou N vezes") — com duas, a lista pulava ao carregar. */}
          <View style={{ flex: 1 }}>
            <Esqueleto largura="62%" altura={12} />
            <Esqueleto largura="40%" altura={9} style={{ marginTop: 8 }} />
            <Esqueleto largura="30%" altura={9} style={{ marginTop: 6 }} />
          </View>
          <Esqueleto largura={54} altura={12} />
        </View>
      ))}
    </CartaoLista>
  );
}

function ProdutoItem({
  produto,
  ultima,
  aoTocar,
  aoAbrirAcoes,
}: {
  produto: ProdutoLocal;
  ultima: boolean;
  aoTocar: () => void;
  aoAbrirAcoes: () => void;
}) {
  const { c } = useTema();
  const tipico = produto.faixaPessoal?.mediana;
  const sufixo = produto.unidadeBase ? `/${produto.unidadeBase}` : '';

  return (
    <Pressable
      onPress={aoTocar}
      style={({ pressed }) => [
        estilos.item,
        !ultima && { borderBottomWidth: 1, borderBottomColor: c.linha },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={estilos.itemTexto}>
        <Texto peso="semibold" tamanho="sm" numberOfLines={1}>
          {produto.nome}
        </Texto>
        {tipico != null ? (
          <Texto cor="fraco" numerico style={estilos.itemSub}>
            {`seu típico ${moeda(tipico)}${sufixo}`}
          </Texto>
        ) : null}
        <Texto cor="fraco" numerico style={estilos.itemSub}>
          {vezesCompradas(produto.nObservacoes)}
        </Texto>
      </View>

      <View style={estilos.itemDireita}>
        {produto.ultimoPreco != null ? (
          <Texto peso="bold" tamanho="sm" numerico>
            {moeda(produto.ultimoPreco)}
          </Texto>
        ) : null}
        <Variacao pct={produto.variacaoPct} />
      </View>

      <Pressable
        onPress={aoAbrirAcoes}
        accessibilityRole="button"
        accessibilityLabel={`Ações de ${produto.nome}`}
        hitSlop={8}
        style={estilos.kebab}
      >
        <IconeKebab tamanho={18} cor={c.fraco} />
      </Pressable>
    </Pressable>
  );
}

/**
 * Indicador de variação do 3a: seta + %, sem pílula. Preço subindo é
 * desfavorável (`caro`); caindo, `barato`; estável vira "na média" em `medio`.
 */
function Variacao({ pct }: { pct?: number }) {
  const { c } = useTema();
  if (pct == null) return null;

  if (Math.abs(pct) < LIMIAR_ESTAVEL) {
    return (
      <Texto peso="semibold" style={[estilos.variacao, { color: c.medio }]}>
        na média
      </Texto>
    );
  }

  const subiu = pct > 0;
  const cor = subiu ? c.caro : c.barato;
  const Icone = subiu ? IconeTendenciaCima : IconeTendenciaBaixo;

  return (
    <View style={estilos.variacaoLinha}>
      <Icone tamanho={12} cor={cor} larguraTraco={3} />
      <Texto peso="semibold" numerico style={[estilos.variacao, { color: cor }]}>
        {Math.abs(pct).toFixed(0)}%
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  linhaBusca: { flexDirection: 'row', gap: 10, marginTop: 14 },
  busca: {
    flex: 1,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: raio.md,
    paddingHorizontal: 14,
  },
  buscaInput: { flex: 1, paddingVertical: 0, fontSize: 13.5 },
  botaoFiltro: {
    width: 46,
    height: 46,
    borderRadius: raio.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 16,
    height: 16,
    borderRadius: raio.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeTexto: { fontSize: 9, lineHeight: 12 },
  lista: { marginTop: 14 },
  vazio: { marginTop: espaco.lg },
  linhaEsqueleto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: 14,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, paddingVertical: 13 },
  itemTexto: { flex: 1 },
  itemSub: { fontSize: 11.5, marginTop: 2 },
  itemDireita: { alignItems: 'flex-end' },
  variacaoLinha: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  variacao: { fontSize: 11.5 },
  kebab: { width: 28, height: 44, alignItems: 'center', justifyContent: 'center' },
  linhaOrdem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: espaco.lg,
    minHeight: 44,
  },
});
