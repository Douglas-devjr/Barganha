/**
 * C7.4 + Redesign "2a" — Meus produtos. Lista o catálogo derivado do histórico
 * (offline): tile com inicial, nome, típico (mediana, R$/base) e um chip de
 * tendência entre a primeira e a última compra. Toque abre o Detalhe (C7.5).
 */

import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import {
  Cartao,
  Estado,
  IconeBusca,
  IconeProdutos,
  IconeTendenciaBaixo,
  IconeTendenciaCima,
  IconeTendenciaPlana,
  Tela,
  Texto,
} from '@/componentes';
import * as catalogo from '@/nucleo/catalogo';
import type { ProdutoLocal } from '@/nucleo/catalogo';
import { espaco, raio, useTema } from '@/tema';
import type { RootStackParamList, TabParamList } from '@/navegacao/tipos';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Produtos'>,
  NativeStackScreenProps<RootStackParamList>
>;

function moeda(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',')}`;
}

// Abaixo de 2% de variação, a tendência é tratada como estável.
const LIMIAR_ESTAVEL = 2;

export function ProdutosTela({ navigation }: Props) {
  const { c } = useTema();
  const [lista, setLista] = useState<ProdutoLocal[]>([]);
  const [busca, setBusca] = useState('');
  const montado = useRef(true);

  useFocusEffect(
    useCallback(() => {
      montado.current = true;
      void (async () => {
        const todos = await catalogo.carregarCatalogo();
        if (montado.current) setLista(todos);
      })();
      return () => {
        montado.current = false;
      };
    }, []),
  );

  const filtrados = busca
    ? lista.filter((p) => p.nome.toLowerCase().includes(busca.toLowerCase()))
    : lista;

  return (
    <Tela titulo="Meus produtos">
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

      {filtrados.length === 0 ? (
        <Cartao style={{ marginTop: espaco.lg }}>
          {lista.length === 0 ? (
            <Estado
              icone={<IconeProdutos tamanho={30} cor={c.teal} />}
              titulo="Nenhum produto ainda"
              texto="Seus produtos aparecem aqui conforme você escaneia cupons."
            />
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: espaco.lg }}>
              <Texto cor="suave" centralizado>
                Nenhum produto encontrado para esta busca.
              </Texto>
            </View>
          )}
        </Cartao>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: espaco.md }}>
          {filtrados.map((p) => (
            <ProdutoItem
              key={p.chave}
              produto={p}
              aoTocar={() => navigation.navigate('ProdutoDetalhe', { chave: p.chave, nome: p.nome })}
            />
          ))}
        </ScrollView>
      )}
    </Tela>
  );
}

function ProdutoItem({ produto, aoTocar }: { produto: ProdutoLocal; aoTocar: () => void }) {
  const { c } = useTema();
  const tipico = produto.faixaPessoal?.mediana;
  const inicial = produto.nome.trim().charAt(0).toUpperCase() || '?';

  return (
    <Pressable
      onPress={aoTocar}
      style={({ pressed }) => [
        estilos.item,
        { backgroundColor: c.cartao, borderColor: c.cartaoBorda },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[estilos.avatar, { backgroundColor: c.tealWash }]}>
        <Texto peso="extrabold" cor="teal">
          {inicial}
        </Texto>
      </View>
      <View style={{ flex: 1 }}>
        <Texto peso="bold" numberOfLines={1}>
          {produto.nome}
        </Texto>
        <Texto cor="fraco" tamanho="sm" style={{ marginTop: 2 }}>
          {tipico != null
            ? `típico ${moeda(tipico)}${produto.unidadeBase ? `/${produto.unidadeBase}` : ''}`
            : `${produto.nObservacoes} ${produto.nObservacoes === 1 ? 'compra' : 'compras'}`}
        </Texto>
      </View>
      <Tendencia pct={produto.variacaoPct} />
    </Pressable>
  );
}

/** Pílula de tendência. Preço subindo é desfavorável (vermelho); caindo, verde. */
function Tendencia({ pct }: { pct?: number }) {
  const { c } = useTema();
  if (pct == null) return null;
  const estavel = Math.abs(pct) < LIMIAR_ESTAVEL;
  const cor = estavel ? c.suave : pct > 0 ? c.caro : c.barato;
  const bg = estavel ? c.semDadosBg : pct > 0 ? c.caroBg : c.baratoBg;
  const Icone = estavel ? IconeTendenciaPlana : pct > 0 ? IconeTendenciaCima : IconeTendenciaBaixo;

  return (
    <View style={[estilos.tendencia, { backgroundColor: bg }]}>
      <Icone tamanho={13} cor={cor} larguraTraco={3} />
      <Texto tamanho="xs" peso="bold" style={{ color: cor }}>
        {`${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
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
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    borderWidth: 1,
    borderRadius: raio.lg,
    padding: espaco.md,
    marginBottom: espaco.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tendencia: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: espaco.sm,
    paddingVertical: espaco.xs,
    borderRadius: raio.pill,
  },
});
