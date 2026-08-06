/**
 * C7.5 + Redesign "3a" — Detalhe do produto. Estrutura do handoff: header com
 * voltar/nome/kebab, card do TÍPICO com badge de tendência e sparkline, a lista
 * de onde comprar e o card de alerta com switch.
 *
 * DIFERENÇA CONSCIENTE: o handoff chama a lista de "Onde comprar hoje" (preço
 * por loja na região). A API só devolve a faixa agregada — não há preço por loja
 * no pool. Em vez de inventar, a seção vira "Onde você já viu": as SUAS compras,
 * loja + preço + data, que são dado real e funcionam offline. Quando existir o
 * endpoint regional por loja, é só trocar a fonte da lista.
 *
 * O "típico" prefere a REGIÃO (cache do delta sync) e cai para o histórico
 * pessoal quando a região ainda não tem base — e o rótulo diz qual dos dois é.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { GRAFICO_GRATIS_DIAS } from '@barganha/shared';

import {
  BloqueioPlus,
  Botao,
  CampoTexto,
  Cartao,
  CartaoLista,
  Dialogo,
  Eyebrow,
  FolhaInferior,
  GraficoLinha,
  IconeKebab,
  IconeLixeira,
  IconeLoja,
  IconeTendenciaBaixo,
  IconeTendenciaCima,
  IconeTendenciaPlana,
  IconeVoltar,
  LinhaFolha,
  Tela,
  Texto,
  useToast,
} from '@/componentes';
import { alertas, lista } from '@/dados';
import type { AlertaPreco } from '@/dados/repositorio-alertas';
import { definirAlerta, removerAlerta } from '@/nucleo/alertas';
import * as catalogo from '@/nucleo/catalogo';
import type { CompraHistorico, ProdutoLocal } from '@/nucleo/catalogo';
import { moeda as moedaFmt, parseMoeda } from '@/nucleo/formato';
import { usePermissaoNotificacao } from '@/nucleo/notificacoes-push';
import { agora, completarPiso } from '@/nucleo/ritmo';
import { resolverVeredito } from '@/nucleo/veredito-local';
import { usePlano } from '@/plano';
import { espaco, raio, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'ProdutoDetalhe'>;

/** Abaixo disso a série é tratada como estável (mesmo limiar da lista). */
const LIMIAR_ESTAVEL = 2;

function moeda(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',')}`;
}

function mesAbrev(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
}

function dataCurta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

/** Uma linha por loja: o preço mais recente visto em cada uma. */
interface OndeViu {
  loja: string;
  preco: number;
  em: string;
}

function agruparPorLoja(historico: CompraHistorico[]): OndeViu[] {
  const porLoja = new Map<string, OndeViu>();
  for (const h of historico) {
    if (h.precoNormalizado == null) continue;
    const loja = h.lojaNome ?? 'Mercado';
    const atual = porLoja.get(loja);
    // `historico` vem do mais antigo ao mais recente: o último sobrescreve.
    if (!atual || h.observadoEm >= atual.em) {
      porLoja.set(loja, { loja, preco: h.precoNormalizado, em: h.observadoEm });
    }
  }
  return [...porLoja.values()].sort((a, b) => a.preco - b.preco);
}

export function ProdutoDetalheTela({ navigation, route }: Props) {
  const { c } = useTema();
  const toast = useToast();
  const { dentroDoGrafico, podeAdicionar, limiteDe, mostrarPlus } = usePlano();
  const permissaoNotificacao = usePermissaoNotificacao();
  const { chave, nome } = route.params;
  const [carregando, setCarregando] = useState(true);
  const [produto, setProduto] = useState<ProdutoLocal | null>(null);
  const [historico, setHistorico] = useState<CompraHistorico[]>([]);
  const [naLista, setNaLista] = useState(false);
  const [alerta, setAlerta] = useState<AlertaPreco | null>(null);
  /** Quantos alertas existem no aparelho — o teto do plano é sobre o total. */
  const [totalAlertas, setTotalAlertas] = useState(0);
  const [editandoAlerta, setEditandoAlerta] = useState(false);
  const [alvoInput, setAlvoInput] = useState('');
  /** Típico da REGIÃO (cache do delta sync), quando existe base. */
  const [tipicoRegional, setTipicoRegional] = useState<number | null>(null);
  const [sheetAcoes, setSheetAcoes] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const recarregar = useCallback(async () => {
    const dados = await catalogo.obterProduto(chave);
    return dados;
  }, [chave]);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      const inicio = agora();
      const dados = await recarregar();
      if (!ativo) return;
      const p = dados?.produto ?? null;
      setProduto(p);
      setHistorico(dados?.historico ?? []);

      if (p?.produtoCanonicoId) {
        const id = p.produtoCanonicoId;
        const [estaNaLista, alertaExistente, todosAlertas] = await Promise.all([
          lista.contem(id),
          alertas.obter(id),
          alertas.listar(),
        ]);
        if (!ativo) return;
        setNaLista(estaNaLista);
        setAlerta(alertaExistente);
        setTotalAlertas(todosAlertas.length);

        // Reusa a resolução travada do veredito só para ler a faixa regional.
        const r = await resolverVeredito({
          precoPrateleira: p.ultimoPreco ?? p.faixaPessoal?.mediana ?? 0,
          produtoCanonicoId: id,
          ...(p.faixaPessoal ? { faixaPessoal: p.faixaPessoal } : {}),
        });
        if (ativo) setTipicoRegional(r.hibrido.regional?.faixa.mediana ?? null);
      }
      await completarPiso(inicio);
      if (!ativo) return;
      setCarregando(false);
    })();
    return () => {
      ativo = false;
    };
  }, [recarregar]);

  function abrirEditorAlerta() {
    const sugestao = tipicoRegional ?? produto?.faixaPessoal?.mediana ?? produto?.minimo;
    setAlvoInput(sugestao != null ? (sugestao * 0.9).toFixed(2).replace('.', ',') : '');
    setEditandoAlerta(true);
  }

  async function salvarAlerta() {
    const id = produto?.produtoCanonicoId;
    const alvo = parseMoeda(alvoInput);
    if (!id || alvo == null || alvo <= 0) return;
    const primeiroAlerta = totalAlertas === 0;
    await definirAlerta(id, produto?.nome ?? nome ?? 'Produto', alvo);
    const [atual, todos] = await Promise.all([alertas.obter(id), alertas.listar()]);
    setAlerta(atual);
    setTotalAlertas(todos.length);
    setEditandoAlerta(false);
    toast('Alerta de preço ativado');
    if (primeiroAlerta) permissaoNotificacao.solicitar();
  }

  /**
   * C13.5 — o teto de alertas do plano. Vale só para alertas NOVOS: mexer no
   * alvo de um alerta que já existe nunca esbarra no limite, e desligar sempre
   * pode. Um limite que impede o usuário de DESFAZER não é limite, é armadilha.
   */
  const noLimiteDeAlertas = alerta == null && !podeAdicionar('alertas', totalAlertas);

  async function alternarAlerta(ligar: boolean) {
    const id = produto?.produtoCanonicoId;
    if (!id) return;
    if (ligar) {
      if (noLimiteDeAlertas) {
        mostrarPlus();
        return;
      }
      abrirEditorAlerta();
      return;
    }
    await removerAlerta(id);
    const todos = await alertas.listar();
    setAlerta(null);
    setTotalAlertas(todos.length);
    toast('Alerta de preço desativado');
  }

  async function alternarLista() {
    const id = produto?.produtoCanonicoId;
    if (!id) return;
    if (naLista) {
      await lista.removerPorProdutoCanonicoId(id);
      toast('Removido da lista');
    } else {
      await lista.adicionar(id, produto?.nome ?? nome ?? 'Produto');
      toast('Adicionado à lista');
    }
    setNaLista(!naLista);
    setConfirmando(false);
  }

  const base = produto?.unidadeBase ? `/${produto.unidadeBase}` : '';
  // C13.5 — a janela do gráfico é do plano; o TÍPICO, o menor, o maior e a
  // tendência do card acima NÃO são cortados. O julgamento de preço é igual nos
  // dois planos (regra travada nº 2, docs/21) — o que o plus dá é o retrospecto.
  const serieCompleta = historico.filter((h) => h.precoNormalizado != null);
  const serie = serieCompleta.filter((h) => dentroDoGrafico(h.observadoEm));
  const pontosOcultos = serieCompleta.length - serie.length;
  const valores = serie.map((h) => h.precoNormalizado as number);
  const pontoInicial = serie[0];
  const pontoFinal = serie.at(-1);
  const ondeViu = agruparPorLoja(historico);

  // Típico exibido: região quando há base; senão o histórico pessoal.
  const tipico = tipicoRegional ?? produto?.faixaPessoal?.mediana ?? null;
  const rotuloTipico = tipicoRegional != null ? 'Típico na sua região' : 'Típico no seu histórico';
  const variacao = produto?.variacaoPct;

  return (
    <Tela>
      {/* header do handoff: voltar circular + eyebrow/nome + kebab */}
      <View style={estilos.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={[estilos.circulo, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }]}
        >
          <IconeVoltar tamanho={19} cor={c.tinta} />
        </Pressable>

        <View style={estilos.headerTexto}>
          {produto?.unidadeBase ? <Eyebrow>{`por ${produto.unidadeBase}`}</Eyebrow> : null}
          <Texto peso="bold" style={estilos.headerNome} numberOfLines={2}>
            {produto?.nome ?? nome ?? 'Produto'}
          </Texto>
        </View>

        {produto?.produtoCanonicoId ? (
          <Pressable
            onPress={() => setSheetAcoes(true)}
            accessibilityRole="button"
            accessibilityLabel="Ações do produto"
            style={[estilos.circulo, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }]}
          >
            <IconeKebab tamanho={18} cor={c.tinta} />
          </Pressable>
        ) : null}
      </View>

      {carregando ? (
        <Cartao>
          <View style={estilos.carregando}>
            <ActivityIndicator color={c.tinta} />
          </View>
        </Cartao>
      ) : !produto ? (
        <Cartao>
          <Texto cor="suave" centralizado>
            Não encontramos o histórico deste produto.
          </Texto>
        </Cartao>
      ) : (
        <>
          {/* hero: típico + tendência + sparkline + extremos */}
          <View style={[estilos.hero, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }]}>
            <View style={estilos.heroTopo}>
              <Eyebrow style={{ flex: 1 }}>{rotuloTipico}</Eyebrow>
              <Tendencia pct={variacao} />
            </View>

            <Texto peso="bold" numerico style={estilos.heroValor}>
              {tipico != null ? `${moeda(tipico)}${base}` : '—'}
            </Texto>

            <View style={{ marginTop: espaco.md }}>
              <GraficoLinha
                valores={valores}
                inicio={
                  serie.length > 1 && pontoInicial ? mesAbrev(pontoInicial.observadoEm) : undefined
                }
                fim={serie.length > 1 && pontoFinal ? mesAbrev(pontoFinal.observadoEm) : undefined}
              />
            </View>

            <View style={[estilos.heroRodape, { borderTopColor: c.linha }]}>
              <Texto cor="fraco" numerico style={estilos.extremo}>
                {produto.minimo != null ? `menor ${moeda(produto.minimo)}` : 'menor —'}
              </Texto>
              {variacao != null && Math.abs(variacao) >= LIMIAR_ESTAVEL ? (
                <Texto
                  peso="semibold"
                  numerico
                  style={[
                    estilos.extremo,
                    estilos.extremoCentro,
                    { color: variacao < 0 ? c.barato : c.caro },
                  ]}
                >
                  {variacao > 0 ? '+' : ''}
                  {variacao.toFixed(0)}% no período
                </Texto>
              ) : (
                <Texto cor="fraco" style={[estilos.extremo, estilos.extremoCentro]}>
                  estável
                </Texto>
              )}
              <Texto cor="fraco" numerico style={[estilos.extremo, estilos.extremoFim]}>
                {produto.maximo != null ? `maior ${moeda(produto.maximo)}` : 'maior —'}
              </Texto>
            </View>
          </View>

          {pontosOcultos > 0 ? (
            <BloqueioPlus
              titulo="A evolução do ano inteiro"
              texto={`O gráfico mostra ${GRAFICO_GRATIS_DIAS} dias — há mais ${pontosOcultos} ${
                pontosOcultos === 1 ? 'registro' : 'registros'
              } antes disso.`}
              onPress={mostrarPlus}
              style={estilos.bloqueio}
            />
          ) : null}

          {/* "Onde comprar hoje" do handoff, com dado real: suas próprias compras */}
          {ondeViu.length > 0 ? (
            <>
              <Texto peso="bold" style={estilos.secao}>
                Onde você já viu
              </Texto>
              <CartaoLista>
                {ondeViu.map((o, idx) => (
                  <View
                    key={o.loja}
                    style={[
                      estilos.linhaLoja,
                      idx < ondeViu.length - 1 && {
                        borderBottomWidth: 1,
                        borderBottomColor: c.linha,
                      },
                    ]}
                  >
                    <View style={[estilos.tileLoja, { backgroundColor: c.linha }]}>
                      <IconeLoja tamanho={17} cor={c.tinta} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Texto peso="semibold" tamanho="sm" numberOfLines={1}>
                        {o.loja}
                      </Texto>
                      <Texto cor="fraco" tamanho="xs" style={{ marginTop: 2 }}>
                        {dataCurta(o.em)}
                      </Texto>
                    </View>
                    {idx === 0 && ondeViu.length > 1 ? (
                      <View style={[estilos.badgeMenor, { borderColor: c.borda }]}>
                        <Texto peso="bold" cor="suave" style={estilos.badgeMenorTexto}>
                          MENOR
                        </Texto>
                      </View>
                    ) : null}
                    <Texto peso="bold" tamanho="sm" numerico>
                      {moeda(o.preco)}
                      {base}
                    </Texto>
                  </View>
                ))}
              </CartaoLista>
              <Texto cor="fraco" tamanho="xs" style={estilos.notaLoja}>
                Preços das suas próprias compras — o mais recente por mercado.
              </Texto>
            </>
          ) : null}

          {/* alerta de preço com switch (padrão do handoff) */}
          {produto.produtoCanonicoId ? (
            <Cartao style={{ marginTop: espaco.lg }}>
              {editandoAlerta ? (
                <>
                  <CampoTexto
                    rotulo={`Me avise quando chegar a (R$${base})`}
                    value={alvoInput}
                    onChangeText={setAlvoInput}
                    keyboardType="decimal-pad"
                    placeholder="0,00"
                  />
                  <View style={estilos.acoesAlerta}>
                    <Botao
                      titulo="Cancelar"
                      variante="fantasma"
                      onPress={() => setEditandoAlerta(false)}
                      style={{ flex: 1 }}
                    />
                    <Botao
                      titulo="Salvar alerta"
                      onPress={() => void salvarAlerta()}
                      style={{ flex: 1 }}
                    />
                  </View>
                </>
              ) : (
                <View style={estilos.linhaAlerta}>
                  <View style={{ flex: 1 }}>
                    <Texto peso="semibold" tamanho="sm">
                      Alerta de preço
                    </Texto>
                    <Texto cor="fraco" tamanho="xs" style={{ marginTop: 2 }}>
                      {alerta
                        ? `Avisamos quando chegar a ${moedaFmt(alerta.precoAlvo)}${base}.`
                        : noLimiteDeAlertas
                          ? `Você já usa seus ${limiteDe('alertas')} alertas. No Barganha+ são ilimitados.`
                          : 'Receba um aviso quando este produto baixar.'}
                    </Texto>
                  </View>
                  <Switch
                    value={alerta != null}
                    onValueChange={(v) => void alternarAlerta(v)}
                    trackColor={{ false: c.linha, true: c.tinta }}
                    thumbColor={c.cartao}
                    accessibilityLabel="Alerta de preço"
                  />
                </View>
              )}
            </Cartao>
          ) : null}
        </>
      )}

      <FolhaInferior
        visivel={sheetAcoes}
        titulo={produto?.nome ?? ''}
        aoFechar={() => setSheetAcoes(false)}
      >
        <LinhaFolha
          rotulo="Editar produto"
          onPress={() => {
            setSheetAcoes(false);
            if (produto) {
              navigation.navigate('EditarProduto', {
                nome: produto.nome,
                produtoCanonicoId: produto.produtoCanonicoId,
                unidadeBase: produto.unidadeBase ?? null,
              });
            }
          }}
        />
        <LinhaFolha
          rotulo={naLista ? 'Tirar da minha lista' : 'Adicionar à minha lista'}
          comBorda={false}
          onPress={() => {
            setSheetAcoes(false);
            if (naLista) setConfirmando(true);
            else void alternarLista();
          }}
        />
      </FolhaInferior>

      <Dialogo
        visivel={confirmando}
        titulo="Tirar da lista?"
        mensagem={`"${produto?.nome ?? ''}" sai da sua lista de compras. O histórico de preços continua intacto.`}
        rotuloConfirmar="Tirar da lista"
        icone={<IconeLixeira tamanho={24} cor={c.caro} />}
        aoConfirmar={() => void alternarLista()}
        aoCancelar={() => setConfirmando(false)}
      />
    </Tela>
  );
}

/** Pílula de tendência do handoff ("em queda" / "em alta" / "estável"). */
function Tendencia({ pct }: { pct?: number }) {
  const { c } = useTema();
  if (pct == null) return null;

  const estavel = Math.abs(pct) < LIMIAR_ESTAVEL;
  const caindo = pct < 0;
  const cor = estavel ? c.medio : caindo ? c.barato : c.caro;
  const Icone = estavel ? IconeTendenciaPlana : caindo ? IconeTendenciaBaixo : IconeTendenciaCima;
  const rotulo = estavel ? 'estável' : caindo ? 'em queda' : 'em alta';

  return (
    <View style={[estilos.tendencia, { borderColor: c.borda }]}>
      <Icone tamanho={13} cor={cor} larguraTraco={2.4} />
      <Texto peso="semibold" style={[estilos.tendenciaTexto, { color: cor }]}>
        {rotulo}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingTop: espaco.sm,
    marginBottom: espaco.lg,
  },
  circulo: {
    width: 44,
    height: 44,
    borderRadius: raio.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTexto: { flex: 1 },
  headerNome: { fontSize: 17, letterSpacing: -0.4, marginTop: 1 },
  carregando: { alignItems: 'center', paddingVertical: espaco.xl },
  hero: {
    borderRadius: raio.cartao,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  heroTopo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  // número gigante do 3a: 40/700/-2
  heroValor: { fontSize: 40, letterSpacing: -2, marginTop: 6 },
  tendencia: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: raio.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tendenciaTexto: { fontSize: 11.5 },
  heroRodape: { flexDirection: 'row', borderTopWidth: 1, marginTop: espaco.md, paddingTop: 10 },
  extremo: { flex: 1, fontSize: 10.5 },
  extremoCentro: { textAlign: 'center' },
  extremoFim: { textAlign: 'right' },
  secao: { fontSize: 16, letterSpacing: -0.4, marginTop: espaco.xl, marginBottom: espaco.sm },
  linhaLoja: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: 13,
    minHeight: 44,
  },
  tileLoja: {
    width: 36,
    height: 36,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeMenor: { borderWidth: 1, borderRadius: raio.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeMenorTexto: { fontSize: 9, letterSpacing: 0.8 },
  notaLoja: { marginTop: espaco.sm, marginLeft: espaco.xs, lineHeight: 15 },
  bloqueio: { marginTop: espaco.sm },
  acoesAlerta: { flexDirection: 'row', gap: espaco.sm, marginTop: espaco.sm },
  linhaAlerta: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
});
