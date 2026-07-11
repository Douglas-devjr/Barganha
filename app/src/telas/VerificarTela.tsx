/**
 * C7.1/C7.2/C7.3 + Redesign "2a" — Verificar (o momento de valor, na gôndola).
 *
 *  • Entrada do produto: código de barras (principal) + busca por nome (fallback).
 *  • Veredito resolvido do CACHE LOCAL primeiro (offline) e refinado online.
 *  • Exibição HÍBRIDA: veredito de destaque (pílula + BarraPreco) + sua região e
 *    seu histórico, com a promoção numa linha à parte ("menor visto").
 *
 * As decisões travadas vivem em `@barganha/shared` (mediana/percentis, nunca
 * média; promoção nunca colapsa no veredito). Aqui só orquestramos e exibimos.
 */

import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  type AnguloVeredito,
  type FaixaPreco,
  normalizarDescricao,
  type UnidadeBase,
} from '@barganha/shared';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  BarraPreco,
  Botao,
  CabecalhoVoltar,
  Cartao,
  IconeBarras,
  IconeBusca,
  Tela,
  Texto,
  VeredictoBadge,
} from '@/componentes';
import * as catalogo from '@/nucleo/catalogo';
import type { ProdutoLocal } from '@/nucleo/catalogo';
import { parseMoeda } from '@/nucleo/formato';
import { consumirEanEscaneado } from '@/nucleo/scan-pendente';
import {
  refinarRegionalOnline,
  resolverVeredito,
  type ResultadoVeredito,
} from '@/nucleo/veredito-local';
import { espaco, raio, useTema, veredito } from '@/tema';
import type { RootStackParamList, TabParamList } from '@/navegacao/tipos';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Verificar'>,
  NativeStackScreenProps<RootStackParamList>
>;

function moeda(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',')}`;
}

function sufixo(base?: UnidadeBase | null): string {
  return base ? `/${base}` : '';
}

function dataCurta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

export function VerificarTela({ navigation }: Props) {
  const { c } = useTema();
  const [lista, setLista] = useState<ProdutoLocal[]>([]);
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<ProdutoLocal | null>(null);
  const [preco, setPreco] = useState('');
  const [resultado, setResultado] = useState<ResultadoVeredito | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [refinando, setRefinando] = useState(false);
  const montado = useRef(true);

  // Recarrega o catálogo e trata um EAN recém-escaneado a cada foco da aba.
  useFocusEffect(
    useCallback(() => {
      montado.current = true;
      void (async () => {
        const todos = await catalogo.carregarCatalogo();
        if (!montado.current) return;
        setLista(todos);

        const ean = consumirEanEscaneado();
        if (ean) {
          const achado = todos.find((p) => p.ean === ean);
          setSelecionado(
            achado ?? {
              chave: `ean:${ean}`,
              produtoCanonicoId: null,
              ean,
              nome: 'Produto escaneado',
              unidadeBase: null,
              nObservacoes: 0,
            },
          );
          setResultado(null);
        }
      })();
      return () => {
        montado.current = false;
      };
    }, []),
  );

  const alvoBusca = normalizarDescricao(busca);
  const filtrados = alvoBusca
    ? lista.filter((p) => normalizarDescricao(p.nome).includes(alvoBusca))
    : lista;

  const valor = parseMoeda(preco);
  const podeVerificar = selecionado != null && valor != null && !calculando;

  async function verificar() {
    if (!selecionado || valor == null) return;
    setCalculando(true);
    const offline = await resolverVeredito({
      precoPrateleira: valor,
      produtoCanonicoId: selecionado.produtoCanonicoId,
      ...(selecionado.faixaPessoal ? { faixaPessoal: selecionado.faixaPessoal } : {}),
    });
    if (!montado.current) return;
    setResultado(offline);
    setCalculando(false);

    setRefinando(true);
    try {
      const resp = await refinarRegionalOnline({ ean: selecionado.ean, nome: selecionado.nome });
      if (resp && montado.current) {
        const canonico = selecionado.produtoCanonicoId ?? resp.produtoCanonicoId;
        const refinado = await resolverVeredito({
          precoPrateleira: valor,
          produtoCanonicoId: canonico,
          ...(selecionado.faixaPessoal ? { faixaPessoal: selecionado.faixaPessoal } : {}),
        });
        if (montado.current) setResultado(refinado);
      }
    } finally {
      if (montado.current) setRefinando(false);
    }
  }

  function reiniciar() {
    setResultado(null);
    setPreco('');
  }

  if (resultado && selecionado) {
    return (
      <Tela>
        <ResultadoVeredictoView
          produto={selecionado}
          precoDigitado={valor ?? 0}
          resultado={resultado}
          refinando={refinando}
          aoVerOutro={reiniciar}
          aoVerHistorico={
            selecionado.nObservacoes > 0
              ? () =>
                  navigation.navigate('ProdutoDetalhe', {
                    chave: selecionado.chave,
                    nome: selecionado.nome,
                  })
              : undefined
          }
        />
      </Tela>
    );
  }

  return (
    <Tela titulo="Verificar preço">
      <Texto cor="suave" style={{ marginTop: -espaco.sm, marginBottom: espaco.lg }}>
        Escaneie o código de barras na gôndola ou escolha um produto do seu histórico.
      </Texto>

      <Botao
        titulo="Escanear código de barras"
        icone={<IconeBarras tamanho={20} cor={c.branco} />}
        bloco
        onPress={() => navigation.navigate('EscanearBarras')}
        style={{ marginBottom: espaco.lg }}
      />

      <View style={estilos.divisor}>
        <View style={[estilos.divisorLinha, { backgroundColor: c.borda }]} />
        <Texto cor="fraco" tamanho="sm" peso="semibold">
          ou busque no histórico
        </Texto>
        <View style={[estilos.divisorLinha, { backgroundColor: c.borda }]} />
      </View>

      <View style={[estilos.busca, { backgroundColor: c.cartao, borderColor: c.borda }]}>
        <IconeBusca tamanho={18} cor={c.fraco} />
        <TextInput
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar produto…"
          placeholderTextColor={c.fraco}
          style={[estilos.buscaInput, { color: c.tinta }]}
        />
      </View>

      {lista.length === 0 ? (
        <Cartao style={{ marginTop: espaco.md }}>
          <Texto cor="suave" centralizado>
            Escaneie cupons para montar seu histórico — ou use o código de barras na gôndola.
          </Texto>
        </Cartao>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={estilos.chips}
        >
          {filtrados.map((p) => {
            const ativo = selecionado?.chave === p.chave;
            return (
              <Pressable
                key={p.chave}
                onPress={() => {
                  setSelecionado(p);
                  setResultado(null);
                }}
                style={[
                  estilos.chip,
                  {
                    backgroundColor: ativo ? c.teal : c.cartao,
                    borderColor: ativo ? c.teal : c.borda,
                  },
                ]}
              >
                <Texto
                  tamanho="sm"
                  peso={ativo ? 'bold' : 'semibold'}
                  cor={ativo ? 'branco' : 'suave'}
                >
                  {p.nome}
                </Texto>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <Texto cor="fraco" tamanho="sm" peso="semibold" style={estilos.rotuloPreco}>
        Preço que você viu na prateleira
      </Texto>
      <View style={[estilos.precoCartao, { backgroundColor: c.cartao, borderColor: c.borda }]}>
        <Texto tamanho="display" peso="bold" cor="fraco">
          R$
        </Texto>
        <TextInput
          value={preco}
          onChangeText={setPreco}
          inputMode="decimal"
          keyboardType="decimal-pad"
          placeholder="0,00"
          placeholderTextColor={c.fraco}
          style={[estilos.precoInput, { color: c.tinta }]}
        />
      </View>

      {selecionado ? (
        <Texto cor="suave" tamanho="sm" centralizado style={{ marginBottom: espaco.md }}>
          Comparando{' '}
          <Texto peso="bold" cor="teal">
            {selecionado.nome}
          </Texto>
          {selecionado.unidadeBase ? ` (por ${selecionado.unidadeBase})` : ''}
        </Texto>
      ) : (
        <Texto cor="fraco" tamanho="sm" centralizado style={{ marginBottom: espaco.md }}>
          Escaneie ou escolha um produto acima.
        </Texto>
      )}

      <Botao
        titulo="Verificar preço"
        bloco
        carregando={calculando}
        desabilitado={!podeVerificar}
        onPress={() => void verificar()}
      />
    </Tela>
  );
}

// ─────────────────────────────── Resultado ───────────────────────────────

interface ResultadoProps {
  produto: ProdutoLocal;
  precoDigitado: number;
  resultado: ResultadoVeredito;
  refinando: boolean;
  aoVerOutro: () => void;
  aoVerHistorico?: () => void;
}

/** Referências da BarraPreco a partir da faixa de destaque (região ou histórico). */
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

function ResultadoVeredictoView({
  produto,
  precoDigitado,
  resultado,
  refinando,
  aoVerOutro,
  aoVerHistorico,
}: ResultadoProps) {
  const { c } = useTema();
  const { hibrido } = resultado;
  const inicial = produto.nome.trim().charAt(0).toUpperCase() || '?';
  const destaque = hibrido.regional ?? hibrido.pessoal;
  const painel = veredito(c)[hibrido.veredito];

  const faixaDestaque = destaque?.faixa;
  const base = faixaDestaque?.unidadeBase;
  const fmt = (v: number) => `${moeda(v)}${sufixo(base)}`;

  const subtitulo = (() => {
    const tip = faixaDestaque?.mediana;
    if (resultado.semDados || !destaque) return 'Ainda sem base para opinar na sua região.';
    if (tip != null && hibrido.veredito !== 'na_media') {
      const d = Math.round((Math.abs(precoDigitado - tip) / tip) * 100);
      const dir = hibrido.veredito === 'barato' ? 'abaixo' : 'acima';
      return `${d}% ${dir} do preço típico ${hibrido.regional ? 'da sua região' : 'do seu histórico'}.`;
    }
    return `Dentro da faixa típica ${hibrido.regional ? 'da sua região' : 'do seu histórico'}.`;
  })();

  return (
    <View>
      <CabecalhoVoltar titulo="Resultado" aoVoltar={aoVerOutro} />

      {/* card do produto */}
      <Cartao style={estilos.cabecalhoResultado}>
        <View style={[estilos.tileProduto, { backgroundColor: c.tealWash }]}>
          <Texto peso="extrabold" tamanho="lg" cor="teal">
            {inicial}
          </Texto>
        </View>
        <View style={{ flex: 1 }}>
          <Texto peso="bold" numberOfLines={2}>
            {produto.nome}
          </Texto>
          <Texto cor="fraco" tamanho="sm" style={{ marginTop: 2 }}>
            {base ? `por ${base} · ` : ''}você viu na prateleira
          </Texto>
        </View>
        <Texto peso="extrabold" tamanho="xl">
          {moeda(precoDigitado)}
        </Texto>
      </Cartao>

      {/* painel de veredito ⭐ */}
      <View style={[estilos.painel, { backgroundColor: painel.bg, borderColor: painel.borda }]}>
        <VeredictoBadge
          veredito={hibrido.veredito}
          poucosDados={(hibrido.regional ?? hibrido.pessoal)?.poucosDados ?? false}
        />
        <Texto cor="suave" tamanho="sm" style={{ marginTop: espaco.md }}>
          {subtitulo}
        </Texto>

        {!resultado.semDados && faixaDestaque ? (
          <View style={{ marginTop: espaco.lg }}>
            {(() => {
              const r = referencias(faixaDestaque, precoDigitado);
              return (
                <BarraPreco
                  preco={precoDigitado}
                  min={r.min}
                  max={r.max}
                  tipico={r.tipico}
                  veredito={hibrido.veredito}
                  formatar={fmt}
                />
              );
            })()}
          </View>
        ) : null}
      </View>

      {resultado.semDados ? (
        <Cartao style={{ marginTop: espaco.lg }}>
          <Texto peso="bold">Sem dados suficientes ainda</Texto>
          <Texto cor="suave" tamanho="sm" style={{ marginTop: espaco.xs }}>
            Assim que houver preços deste produto na sua região (ou no seu histórico), o veredito
            aparece aqui. Tente novamente com sinal para buscar online.
          </Texto>
        </Cartao>
      ) : (
        <Cartao semPadding style={{ marginTop: espaco.lg }}>
          {hibrido.regional ? (
            <AnguloLinha
              titulo="Sua região"
              angulo={hibrido.regional}
              base={`${hibrido.regional.faixa.nObservacoes} ${hibrido.regional.faixa.nObservacoes === 1 ? 'observação' : 'observações'}`}
              comBorda={!!hibrido.pessoal || !!hibrido.promocao}
            />
          ) : null}
          {hibrido.pessoal ? (
            <AnguloLinha
              titulo="Seu histórico"
              angulo={hibrido.pessoal}
              base={
                produto.minimo != null
                  ? `menor já pago ${moeda(produto.minimo)}${sufixo(hibrido.pessoal.faixa.unidadeBase)}`
                  : `${hibrido.pessoal.faixa.nObservacoes} ${hibrido.pessoal.faixa.nObservacoes === 1 ? 'compra' : 'compras'}`
              }
              comBorda={!!hibrido.promocao}
            />
          ) : null}
          {hibrido.promocao ? (
            <View style={[estilos.promoLinha, { backgroundColor: c.ambarBg }]}>
              <View style={[estilos.pontoPromo, { backgroundColor: c.ambar }]} />
              <Texto tamanho="sm" peso="bold" style={{ flex: 1, color: c.ambarTexto }}>
                Menor visto (promoção)
              </Texto>
              <Texto peso="extrabold" style={{ color: c.ambarTexto }}>
                {moeda(hibrido.promocao.menorVisto)}
                {sufixo(hibrido.promocao.unidadeBase)}
              </Texto>
            </View>
          ) : null}
        </Cartao>
      )}

      <View style={estilos.rodape}>
        {refinando ? (
          <View style={estilos.refinando}>
            <ActivityIndicator size="small" color={c.teal} />
            <Texto cor="fraco" tamanho="sm">
              Buscando preços da sua região…
            </Texto>
          </View>
        ) : (
          <Texto cor="fraco" tamanho="xs" centralizado>
            {(() => {
              const f = hibrido.regional?.faixa ?? hibrido.pessoal?.faixa;
              return f ? `Última atualização: ${dataCurta(f.atualizadoEm)}` : '';
            })()}
          </Texto>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: espaco.md, marginTop: espaco.lg }}>
        {aoVerHistorico ? (
          <Botao
            titulo="Ver histórico"
            variante="secundario"
            onPress={aoVerHistorico}
            style={{ flex: 1 }}
          />
        ) : null}
        <Botao titulo="Verificar outro" onPress={aoVerOutro} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function AnguloLinha({
  titulo,
  angulo,
  base,
  comBorda,
}: {
  titulo: string;
  angulo: AnguloVeredito;
  base: string;
  comBorda: boolean;
}) {
  const { c } = useTema();
  const { faixa } = angulo;
  const tipico =
    faixa.mediana != null ? `${moeda(faixa.mediana)}${sufixo(faixa.unidadeBase)}` : '—';
  const faixaTexto =
    faixa.p25 != null && faixa.p75 != null
      ? `${moeda(faixa.p25)} – ${moeda(faixa.p75)}${sufixo(faixa.unidadeBase)}`
      : null;

  return (
    <View
      style={[estilos.angulo, comBorda && { borderBottomWidth: 1, borderBottomColor: c.linha }]}
    >
      <View style={estilos.anguloTopo}>
        <Texto peso="bold" tamanho="sm" cor="suave">
          {titulo}
        </Texto>
        <VeredictoBadge veredito={angulo.veredito} poucosDados={angulo.poucosDados} pequeno />
      </View>
      <View style={estilos.anguloLinha}>
        <Texto cor="suave">Típico</Texto>
        <Texto peso="extrabold">{tipico}</Texto>
      </View>
      {faixaTexto ? (
        <View style={estilos.anguloLinha}>
          <Texto cor="suave" tamanho="sm">
            Faixa normal
          </Texto>
          <Texto peso="semibold" tamanho="sm" cor="fraco">
            {faixaTexto}
          </Texto>
        </View>
      ) : null}
      <Texto cor="fraco" tamanho="xs" style={{ marginTop: espaco.xs }}>
        {base}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  divisor: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.lg },
  divisorLinha: { flex: 1, height: 1 },
  busca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    borderWidth: 1,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
  },
  buscaInput: { flex: 1, paddingVertical: 6, fontSize: 15 },
  chips: { gap: espaco.sm, paddingVertical: espaco.md, paddingRight: espaco.md },
  chip: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.pill,
    borderWidth: 1,
  },
  rotuloPreco: { marginTop: espaco.sm, marginBottom: espaco.sm },
  precoCartao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.xs,
    borderWidth: 1,
    borderRadius: raio.cartao,
    paddingVertical: espaco.lg,
    marginBottom: espaco.md,
  },
  precoInput: {
    minWidth: 140,
    maxWidth: 200,
    textAlign: 'center',
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -2,
    padding: 0,
  },
  cabecalhoResultado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    marginBottom: espaco.lg,
  },
  tileProduto: {
    width: 46,
    height: 46,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  painel: {
    borderRadius: raio.hero,
    borderWidth: 1,
    padding: espaco.xl,
  },
  angulo: { paddingHorizontal: espaco.lg, paddingVertical: espaco.md },
  anguloTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: espaco.sm,
  },
  anguloLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  promoLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
    borderBottomLeftRadius: raio.cartao,
    borderBottomRightRadius: raio.cartao,
  },
  pontoPromo: { width: 8, height: 8, borderRadius: 4 },
  rodape: { marginTop: espaco.md, minHeight: 20 },
  refinando: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.sm,
  },
});
