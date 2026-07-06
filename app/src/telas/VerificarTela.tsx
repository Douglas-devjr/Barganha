/**
 * C7.1/C7.2/C7.3 — Verificar (o momento de valor, na gôndola).
 *
 *  • Entrada do produto: código de barras (principal) + busca por nome (fallback).
 *  • Veredito resolvido do CACHE LOCAL primeiro (offline) e refinado online.
 *  • Exibição HÍBRIDA: sua região (colaborativo) + seu histórico (privado), com a
 *    promoção numa linha à parte ("menor visto") e a "última atualização".
 *
 * As decisões travadas vivem em `@barganha/shared` (mediana/percentis, nunca
 * média; promoção nunca colapsa no veredito). Aqui só orquestramos e exibimos.
 */

import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type AnguloVeredito, normalizarDescricao, type UnidadeBase } from '@barganha/shared';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Botao, Cartao, IconeBarras, IconeBusca, Tela, Texto, VeredictoBadge } from '@/componentes';
import * as catalogo from '@/nucleo/catalogo';
import type { ProdutoLocal } from '@/nucleo/catalogo';
import { parseMoeda } from '@/nucleo/formato';
import {
  refinarRegionalOnline,
  resolverVeredito,
  type ResultadoVeredito,
} from '@/nucleo/veredito-local';
import { cores, espaco, raio } from '@/tema';
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

export function VerificarTela({ navigation, route }: Props) {
  const [lista, setLista] = useState<ProdutoLocal[]>([]);
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<ProdutoLocal | null>(null);
  const [preco, setPreco] = useState('');
  const [resultado, setResultado] = useState<ResultadoVeredito | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [refinando, setRefinando] = useState(false);
  const montado = useRef(true);
  const eanTratado = useRef<string | null>(null);

  // Recarrega o catálogo e trata um EAN recém-escaneado a cada foco da aba.
  useFocusEffect(
    useCallback(() => {
      montado.current = true;
      void (async () => {
        const todos = await catalogo.carregarCatalogo();
        if (!montado.current) return;
        setLista(todos);

        const ean = route.params?.ean;
        if (!ean) {
          // Param já consumido/limpo: libera o guard para um novo scan —
          // inclusive do MESMO código de barras (re-verificação na gôndola).
          eanTratado.current = null;
        } else if (eanTratado.current !== ean) {
          eanTratado.current = ean;
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
          navigation.setParams({ ean: undefined });
        }
      })();
      return () => {
        montado.current = false;
      };
    }, [route.params?.ean, navigation]),
  );

  // Busca sem acento/caixa (mesma normalização do casamento de produto).
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

    // Refino online: traz/atualiza a faixa regional e re-resolve com ela.
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
      <Tela titulo="Verificar preço">
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
      <Botao
        titulo="Escanear código de barras"
        icone={<IconeBarras tamanho={20} cor={cores.branco} />}
        bloco
        onPress={() => navigation.navigate('EscanearBarras')}
        style={{ marginBottom: espaco.lg }}
      />

      <Texto cor="textoMudo" tamanho="sm" peso="semibold" style={{ marginBottom: espaco.sm }}>
        Ou escolha um produto do seu histórico
      </Texto>
      <View style={estilos.busca}>
        <IconeBusca tamanho={18} cor={cores.placeholder} />
        <TextInput
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar produto…"
          placeholderTextColor={cores.placeholder}
          style={estilos.buscaInput}
        />
      </View>

      {lista.length === 0 ? (
        <Cartao style={{ marginTop: espaco.md }}>
          <Texto cor="textoMudo" centralizado>
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
                style={[estilos.chip, ativo && estilos.chipAtivo]}
              >
                <Texto
                  tamanho="sm"
                  peso={ativo ? 'bold' : 'semibold'}
                  cor={ativo ? 'branco' : 'textoSuave'}
                >
                  {p.nome}
                </Texto>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <Texto cor="textoMudo" tamanho="sm" peso="semibold" style={estilos.rotuloPreco}>
        Preço que você viu na prateleira
      </Texto>
      <View style={estilos.precoCartao}>
        <Texto tamanho="display" peso="bold" cor="placeholder">
          R$
        </Texto>
        <TextInput
          value={preco}
          onChangeText={setPreco}
          inputMode="decimal"
          keyboardType="decimal-pad"
          placeholder="0,00"
          placeholderTextColor={cores.placeholder}
          style={estilos.precoInput}
        />
      </View>

      {selecionado ? (
        <Texto cor="textoMudo" tamanho="sm" centralizado style={{ marginBottom: espaco.md }}>
          Comparando{' '}
          <Texto peso="bold" cor="marca">
            {selecionado.nome}
          </Texto>
          {selecionado.unidadeBase ? ` (por ${selecionado.unidadeBase})` : ''}
        </Texto>
      ) : (
        <Texto cor="placeholder" tamanho="sm" centralizado style={{ marginBottom: espaco.md }}>
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

function ResultadoVeredictoView({
  produto,
  precoDigitado,
  resultado,
  refinando,
  aoVerOutro,
  aoVerHistorico,
}: ResultadoProps) {
  const { hibrido } = resultado;

  return (
    <View>
      <Cartao style={estilos.cabecalhoResultado}>
        <View style={{ flex: 1 }}>
          <Texto peso="bold">{produto.nome}</Texto>
          <Texto cor="placeholder" tamanho="sm">
            Você viu na prateleira
          </Texto>
        </View>
        <Texto peso="extrabold" tamanho="xl">
          {moeda(precoDigitado)}
        </Texto>
      </Cartao>

      <View style={estilos.veredictoCentro}>
        <VeredictoBadge
          veredito={hibrido.veredito}
          poucosDados={(hibrido.regional ?? hibrido.pessoal)?.poucosDados ?? false}
        />
        <Texto cor="textoMudo" tamanho="sm" centralizado style={{ marginTop: espaco.sm }}>
          {hibrido.regional
            ? 'comparado ao típico da sua região'
            : hibrido.pessoal
              ? 'comparado ao seu histórico'
              : 'ainda sem base para opinar'}
        </Texto>
      </View>

      {resultado.semDados ? (
        <Cartao>
          <Texto peso="bold">Sem dados suficientes ainda</Texto>
          <Texto cor="textoMudo" tamanho="sm" style={{ marginTop: espaco.xs }}>
            Assim que houver preços deste produto na sua região (ou no seu histórico), o veredito
            aparece aqui. Tente novamente com sinal para buscar online.
          </Texto>
        </Cartao>
      ) : (
        <Cartao semPadding>
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
            <View style={estilos.promoLinha}>
              <View style={[estilos.pontoPromo, { backgroundColor: cores.promocao }]} />
              <Texto tamanho="sm" peso="semibold" style={{ flex: 1, color: cores.promocao }}>
                Menor visto (promoção)
              </Texto>
              <Texto peso="extrabold" style={{ color: cores.promocao }}>
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
            <ActivityIndicator size="small" color={cores.marca} />
            <Texto cor="placeholder" tamanho="sm">
              Buscando preços da sua região…
            </Texto>
          </View>
        ) : (
          <Texto cor="placeholder" tamanho="xs" centralizado>
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
  const { faixa } = angulo;
  const tipico =
    faixa.mediana != null ? `${moeda(faixa.mediana)}${sufixo(faixa.unidadeBase)}` : '—';
  const faixaTexto =
    faixa.p25 != null && faixa.p75 != null
      ? `${moeda(faixa.p25)} – ${moeda(faixa.p75)}${sufixo(faixa.unidadeBase)}`
      : null;

  return (
    <View style={[estilos.angulo, comBorda && estilos.anguloBorda]}>
      <View style={estilos.anguloTopo}>
        <Texto peso="bold" tamanho="sm" cor="textoMudo">
          {titulo}
        </Texto>
        <VeredictoBadge veredito={angulo.veredito} poucosDados={angulo.poucosDados} />
      </View>
      <View style={estilos.anguloLinha}>
        <Texto cor="textoSuave">Típico</Texto>
        <Texto peso="extrabold">{tipico}</Texto>
      </View>
      {faixaTexto ? (
        <View style={estilos.anguloLinha}>
          <Texto cor="textoSuave" tamanho="sm">
            Faixa normal
          </Texto>
          <Texto peso="semibold" tamanho="sm" cor="textoMudo">
            {faixaTexto}
          </Texto>
        </View>
      ) : null}
      <Texto cor="placeholder" tamanho="xs" style={{ marginTop: espaco.xs }}>
        {base}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  busca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    backgroundColor: cores.superficie,
    borderColor: cores.borda,
    borderWidth: 1,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
  },
  buscaInput: { flex: 1, paddingVertical: 6, color: cores.texto, fontSize: 15 },
  chips: { gap: espaco.sm, paddingVertical: espaco.md, paddingRight: espaco.md },
  chip: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.pill,
    backgroundColor: cores.superficie,
    borderWidth: 1,
    borderColor: cores.borda,
  },
  chipAtivo: { backgroundColor: cores.marca, borderColor: cores.marca },
  rotuloPreco: { marginTop: espaco.sm, marginBottom: espaco.sm },
  precoCartao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.xs,
    backgroundColor: cores.superficie,
    borderColor: cores.borda,
    borderWidth: 1,
    borderRadius: raio.xl,
    paddingVertical: espaco.lg,
    marginBottom: espaco.md,
  },
  precoInput: {
    minWidth: 140,
    maxWidth: 200,
    textAlign: 'center',
    fontSize: 44,
    fontWeight: '800',
    color: cores.texto,
    padding: 0,
  },
  cabecalhoResultado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    marginBottom: espaco.lg,
  },
  veredictoCentro: { alignItems: 'center', marginBottom: espaco.lg },
  angulo: { paddingHorizontal: espaco.lg, paddingVertical: espaco.md },
  anguloBorda: { borderBottomWidth: 1, borderBottomColor: cores.borda },
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
    backgroundColor: cores.promocaoBg,
    borderBottomLeftRadius: raio.lg,
    borderBottomRightRadius: raio.lg,
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
