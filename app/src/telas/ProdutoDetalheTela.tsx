/**
 * C7.5 — Detalhe do produto. Mostra a evolução do preço (R$/base) ao longo do
 * histórico, os extremos (menor/típico/maior) e a lista de compras (loja, data,
 * preço, promoção). Tudo offline, a partir do catálogo local.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import {
  Botao,
  CabecalhoVoltar,
  CampoTexto,
  Cartao,
  GraficoLinha,
  Tela,
  Texto,
} from '@/componentes';
import { alertas, lista } from '@/dados';
import type { AlertaPreco } from '@/dados/repositorio-alertas';
import * as catalogo from '@/nucleo/catalogo';
import type { CompraHistorico, ProdutoLocal } from '@/nucleo/catalogo';
import { moeda as moedaFmt, parseMoeda } from '@/nucleo/formato';
import { espaco, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'ProdutoDetalhe'>;

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

export function ProdutoDetalheTela({ navigation, route }: Props) {
  const { c } = useTema();
  const { chave, nome } = route.params;
  const [carregando, setCarregando] = useState(true);
  const [produto, setProduto] = useState<ProdutoLocal | null>(null);
  const [historico, setHistorico] = useState<CompraHistorico[]>([]);
  const [naLista, setNaLista] = useState(false);
  const [alerta, setAlerta] = useState<AlertaPreco | null>(null);
  const [editandoAlerta, setEditandoAlerta] = useState(false);
  const [alvoInput, setAlvoInput] = useState('');

  useEffect(() => {
    let ativo = true;
    void (async () => {
      const dados = await catalogo.obterProduto(chave);
      if (!ativo) return;
      setProduto(dados?.produto ?? null);
      setHistorico(dados?.historico ?? []);
      if (dados?.produto?.produtoCanonicoId) {
        const id = dados.produto.produtoCanonicoId;
        const [estaNaLista, alertaExistente] = await Promise.all([
          lista.contem(id),
          alertas.obter(id),
        ]);
        if (!ativo) return;
        setNaLista(estaNaLista);
        setAlerta(alertaExistente);
      }
      setCarregando(false);
    })();
    return () => {
      ativo = false;
    };
  }, [chave]);

  // C8.4 — alerta de preço: alvo em R$/unidade-base, checado no Início contra
  // o cache regional. Pré-preenche com ~90% do típico pessoal (um alvo realista).
  function abrirEditorAlerta() {
    const sugestao = produto?.faixaPessoal?.mediana ?? produto?.minimo;
    setAlvoInput(sugestao != null ? (sugestao * 0.9).toFixed(2).replace('.', ',') : '');
    setEditandoAlerta(true);
  }

  async function salvarAlerta() {
    const id = produto?.produtoCanonicoId;
    const alvo = parseMoeda(alvoInput);
    if (!id || alvo == null || alvo <= 0) return;
    await alertas.definir(id, produto?.nome ?? nome ?? 'Produto', alvo);
    setAlerta(await alertas.obter(id));
    setEditandoAlerta(false);
  }

  async function removerAlerta() {
    const id = produto?.produtoCanonicoId;
    if (!id) return;
    await alertas.remover(id);
    setAlerta(null);
  }

  // C12.1 — entra/sai da lista de compras. Só produtos com id canônico são
  // comparáveis entre lojas; sem ele o botão nem aparece.
  async function alternarLista() {
    const id = produto?.produtoCanonicoId;
    if (!id) return;
    if (naLista) {
      await lista.remover(id);
    } else {
      await lista.adicionar(id, produto?.nome ?? nome ?? 'Produto');
    }
    setNaLista(!naLista);
  }

  const base = produto?.unidadeBase ? `/${produto.unidadeBase}` : '';
  const serie = historico.filter((h) => h.precoNormalizado != null);
  const valores = serie.map((h) => h.precoNormalizado as number);
  const recentes = [...historico].reverse();
  const pontoInicial = serie[0];
  const pontoFinal = serie.at(-1);

  return (
    <Tela>
      <CabecalhoVoltar
        titulo={produto?.nome ?? nome ?? 'Produto'}
        subtitulo={produto ? `Evolução de preço${base}` : undefined}
        aoVoltar={() => navigation.goBack()}
      />

      {carregando ? (
        <Cartao>
          <View style={{ alignItems: 'center', paddingVertical: espaco.xl }}>
            <ActivityIndicator color={c.teal} />
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
          <Cartao style={{ marginBottom: espaco.md }}>
            <View style={estilos.tituloGrafico}>
              <Texto cor="fraco" tamanho="sm" peso="semibold">
                Evolução do preço
              </Texto>
              <Texto cor="teal" tamanho="sm" peso="bold">
                {serie.length} {serie.length === 1 ? 'compra' : 'compras'}
              </Texto>
            </View>
            <GraficoLinha
              valores={valores}
              inicio={
                serie.length > 1 && pontoInicial ? mesAbrev(pontoInicial.observadoEm) : undefined
              }
              fim={serie.length > 1 && pontoFinal ? mesAbrev(pontoFinal.observadoEm) : undefined}
            />
          </Cartao>

          <View style={estilos.cards}>
            <CardExtremo rotulo="Menor" valor={produto.minimo} sufixo={base} cor={c.barato} />
            <CardExtremo
              rotulo="Típico"
              valor={produto.faixaPessoal?.mediana}
              sufixo={base}
              cor={c.tinta}
            />
            <CardExtremo rotulo="Maior" valor={produto.maximo} sufixo={base} cor={c.caro} />
          </View>

          {produto.produtoCanonicoId ? (
            <>
              <Botao
                titulo={naLista ? 'Tirar da minha lista' : 'Adicionar à minha lista'}
                variante={naLista ? 'fantasma' : 'secundario'}
                bloco
                onPress={() => void alternarLista()}
                style={{ marginBottom: espaco.sm }}
              />

              <Cartao style={{ marginBottom: espaco.lg }}>
                {editandoAlerta ? (
                  <>
                    <CampoTexto
                      rotulo={`Me avise quando a região chegar a (R$${base})`}
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
                ) : alerta ? (
                  <View style={estilos.linhaAlerta}>
                    <View style={{ flex: 1 }}>
                      <Texto peso="bold" tamanho="sm">
                        🔔 Alerta ativo
                      </Texto>
                      <Texto cor="fraco" tamanho="xs">
                        Avisamos no Início quando a região chegar a {moedaFmt(alerta.precoAlvo)}
                        {base}.
                      </Texto>
                    </View>
                    <Botao
                      titulo="Remover"
                      variante="fantasma"
                      onPress={() => void removerAlerta()}
                    />
                  </View>
                ) : (
                  <Botao
                    titulo="Criar alerta de preço"
                    variante="fantasma"
                    bloco
                    onPress={abrirEditorAlerta}
                  />
                )}
              </Cartao>
            </>
          ) : null}

          <Texto peso="extrabold" tamanho="lg" style={{ marginBottom: espaco.sm }}>
            Compras
          </Texto>
          <Cartao semPadding>
            {recentes.map((h, idx) => (
              <View
                key={`${h.observadoEm}-${idx}`}
                style={[
                  estilos.compra,
                  idx < recentes.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.linha },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Texto peso="bold" tamanho="sm">
                    {h.lojaNome ?? 'Mercado'}
                  </Texto>
                  <Texto cor="fraco" tamanho="xs">
                    {dataCurta(h.observadoEm)}
                    {h.emPromocao ? ' · promoção' : ''}
                  </Texto>
                </View>
                <Texto peso="extrabold" style={h.emPromocao ? { color: c.ambarTexto } : undefined}>
                  {h.precoNormalizado != null ? `${moeda(h.precoNormalizado)}${base}` : '—'}
                </Texto>
              </View>
            ))}
          </Cartao>
        </>
      )}
    </Tela>
  );
}

function CardExtremo({
  rotulo,
  valor,
  sufixo,
  cor,
}: {
  rotulo: string;
  valor?: number;
  sufixo: string;
  cor: string;
}) {
  return (
    <Cartao style={estilos.cardExtremo}>
      <Texto cor="placeholder" tamanho="xs" peso="semibold">
        {rotulo}
      </Texto>
      <Texto peso="extrabold" tamanho="lg" style={{ color: cor, marginTop: espaco.xs }}>
        {valor != null ? moeda(valor) : '—'}
      </Texto>
      {valor != null && sufixo ? (
        <Texto cor="placeholder" tamanho="xs">
          {sufixo}
        </Texto>
      ) : null}
    </Cartao>
  );
}

const estilos = StyleSheet.create({
  tituloGrafico: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: espaco.md,
  },
  cards: { flexDirection: 'row', gap: espaco.sm, marginBottom: espaco.lg },
  acoesAlerta: { flexDirection: 'row', gap: espaco.sm, marginTop: espaco.sm },
  linhaAlerta: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  cardExtremo: { flex: 1, alignItems: 'center', paddingVertical: espaco.md },
  compra: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
});
