/**
 * C12.1 — Minha lista de compras + comparação por loja ("onde a cesta sai mais
 * barata"). A lista é LOCAL (aparelho); a comparação consulta o endpoint
 * anônimo `/consulta/lista` com o recorte de região do usuário e mostra o
 * ranking de lojas por cobertura e total — mediana da região, nunca média
 * (decisão travada nº6); promoção é informativa, fora do total.
 *
 * Itens entram pela tela do produto ("Adicionar à lista") — só produtos com id
 * canônico são comparáveis entre lojas. A comparação precisa de internet; a
 * lista em si funciona offline.
 */

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ComparacaoListaResponse } from '@barganha/shared';

import { clienteApi } from '@/api';
import { Botao, CabecalhoVoltar, Cartao, IconeTrofeu, Tela, Texto } from '@/componentes';
import { lista } from '@/dados';
import type { ItemLista } from '@/dados/repositorio-lista';
import { moeda } from '@/nucleo/formato';
import { resolverLocalizacao } from '@/nucleo/localizacao';
import { espaco, raio, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'ListaCompras'>;

export function ListaComprasTela({ navigation }: Props) {
  const { c } = useTema();
  const [itens, setItens] = useState<ItemLista[]>([]);
  const [comparando, setComparando] = useState(false);
  const [comparacao, setComparacao] = useState<ComparacaoListaResponse | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setItens(await lista.listar());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void recarregar();
    }, [recarregar]),
  );

  async function mudarQuantidade(item: ItemLista, delta: number) {
    const nova = item.quantidade + delta;
    if (nova < 1) return;
    await lista.definirQuantidade(item.produtoCanonicoId, nova);
    setComparacao(null); // a cesta mudou — o ranking antigo não vale mais.
    await recarregar();
  }

  async function remover(item: ItemLista) {
    await lista.remover(item.produtoCanonicoId);
    setComparacao(null);
    await recarregar();
  }

  async function comparar() {
    setComparando(true);
    setAviso(null);
    try {
      const local = await resolverLocalizacao();
      const resposta = await clienteApi.compararLista({
        itens: itens.map((i) => ({
          produtoCanonicoId: i.produtoCanonicoId,
          quantidade: i.quantidade,
        })),
        ...(local?.municipio ? { municipio: local.municipio } : {}),
        ...(local?.uf ? { uf: local.uf } : {}),
      });
      setComparacao(resposta);
      if (resposta.lojas.length === 0) {
        setAviso(
          'Ainda não há preços por loja suficientes na sua região para esta lista. Cada cupom escaneado ajuda a preencher.',
        );
      }
    } catch {
      setAviso('Não deu para comparar agora. Verifique a conexão e tente de novo.');
    } finally {
      setComparando(false);
    }
  }

  return (
    <Tela>
      <CabecalhoVoltar
        titulo="Minha lista"
        subtitulo="Compare onde a cesta sai mais barata"
        aoVoltar={() => navigation.goBack()}
      />

      {itens.length === 0 ? (
        <Cartao>
          <Texto peso="bold" centralizado style={{ marginBottom: espaco.xs }}>
            Sua lista está vazia
          </Texto>
          <Texto cor="suave" tamanho="sm" centralizado>
            Abra um produto do seu histórico e toque em “Adicionar à lista” para montar a cesta.
          </Texto>
        </Cartao>
      ) : (
        <>
          <Cartao semPadding style={{ marginBottom: espaco.md }}>
            {itens.map((item, idx) => (
              <View
                key={item.produtoCanonicoId}
                style={[
                  estilos.item,
                  idx < itens.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.linha },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Texto peso="bold" tamanho="sm" numberOfLines={2}>
                    {item.nome}
                  </Texto>
                </View>
                <View style={estilos.stepper}>
                  <BotaoMini rotulo="−" aoPressionar={() => void mudarQuantidade(item, -1)} />
                  <Texto peso="extrabold" style={estilos.qtd}>
                    {item.quantidade}
                  </Texto>
                  <BotaoMini rotulo="+" aoPressionar={() => void mudarQuantidade(item, +1)} />
                </View>
                <Pressable
                  onPress={() => void remover(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Tirar ${item.nome} da lista`}
                  hitSlop={8}
                >
                  <Texto cor="fraco" peso="bold">
                    ✕
                  </Texto>
                </Pressable>
              </View>
            ))}
          </Cartao>

          <Botao
            titulo="Onde está mais barata?"
            bloco
            carregando={comparando}
            onPress={() => void comparar()}
          />
        </>
      )}

      {aviso ? (
        <Texto cor="suave" tamanho="sm" centralizado style={{ marginTop: espaco.md }}>
          {aviso}
        </Texto>
      ) : null}

      {comparacao && comparacao.lojas.length > 0 ? (
        <View style={{ marginTop: espaco.lg }}>
          <Texto peso="extrabold" tamanho="lg" style={{ marginBottom: espaco.sm }}>
            Sua cesta por mercado
          </Texto>
          {comparacao.lojas.map((loja, idx) => (
            <Cartao key={loja.lojaCnpj} style={{ marginBottom: espaco.sm }}>
              <View style={estilos.linhaLoja}>
                <View style={{ flex: 1 }}>
                  <View style={estilos.nomeLoja}>
                    {/* 3a é só SVG stroke — o troféu do 1º lugar era emoji. */}
                    {idx === 0 ? <IconeTrofeu tamanho={14} cor={c.tinta} larguraTraco={2} /> : null}
                    <Texto peso="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {loja.nome ?? 'Mercado'}
                    </Texto>
                  </View>
                  <Texto cor="fraco" tamanho="xs">
                    {loja.itensCobertos === comparacao.itensTotal
                      ? 'Lista completa'
                      : `Cobre ${loja.itensCobertos} de ${comparacao.itensTotal} itens`}
                    {loja.municipio ? ` · ${loja.municipio}` : ''}
                  </Texto>
                </View>
                {/* a loja mais barata é destacada no verde do semáforo — no 3a a
                    tinta não destaca nada, é a cor padrão do texto. */}
                <Texto
                  peso="bold"
                  tamanho="lg"
                  numerico
                  style={idx === 0 ? { color: c.barato } : undefined}
                >
                  {moeda(loja.total)}
                </Texto>
              </View>
            </Cartao>
          ))}
          <Texto cor="placeholder" tamanho="xs" centralizado style={{ marginTop: espaco.xs }}>
            Preço típico da região (mediana), por unidade-base × quantidade. É comparação, não
            orçamento — promoções aparecem no produto.
          </Texto>
        </View>
      ) : null}
    </Tela>
  );
}

function BotaoMini({ rotulo, aoPressionar }: { rotulo: string; aoPressionar: () => void }) {
  const { c } = useTema();
  return (
    <Pressable
      onPress={aoPressionar}
      accessibilityRole="button"
      accessibilityLabel={rotulo === '+' ? 'Aumentar quantidade' : 'Diminuir quantidade'}
      style={[estilos.botaoMini, { backgroundColor: c.linha }]}
      hitSlop={6}
    >
      <Texto peso="extrabold">{rotulo}</Texto>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  qtd: { minWidth: 20, textAlign: 'center' },
  botaoMini: {
    width: 28,
    height: 28,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nomeLoja: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  linhaLoja: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
  },
});
