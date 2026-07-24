/**
 * Handoff 3a (`sheet:addItem`) — bottom-sheet de busca ao vivo para pôr um
 * produto na lista de compras.
 *
 * A busca é no CATÁLOGO LOCAL (o que o usuário já comprou), não no pool: é o
 * único conjunto que existe offline e o que ele reconhece pelo nome. Só entram
 * produtos com id canônico — a lista é comparada entre lojas por esse id, e um
 * item sem ele não teria com o que ser comparado.
 *
 * Mesma lógica de busca de "Comparar mercados" (ver `filtrarPorNome`).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { ProdutoLocal } from '@/nucleo/catalogo';
import { moeda } from '@/nucleo/formato';
import { espaco, raio, useTema } from '@/tema';

import { FolhaInferior } from './FolhaInferior';
import { IconeBusca, IconeLoja, IconeMais } from './icones';
import { Texto } from './Texto';

/**
 * Busca por nome, sem acento e sem caso — a mesma dos dois lugares que buscam
 * produto (este sheet e Comparar mercados). Sem texto, devolve o catálogo todo.
 */
export function filtrarPorNome<T extends { nome: string }>(
  itens: readonly T[],
  texto: string,
): T[] {
  const alvo = normalizar(texto);
  if (!alvo) return [...itens];
  return itens.filter((i) => normalizar(i.nome).includes(alvo));
}

function normalizar(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface FolhaAdicionarItemProps {
  visivel: boolean;
  /** Catálogo local já carregado pela tela (evita recarregar a cada abertura). */
  candidatos: readonly ProdutoLocal[];
  /** Ids já na lista — aparecem marcados e não podem ser adicionados de novo. */
  jaNaLista: ReadonlySet<string>;
  aoAdicionar: (produto: ProdutoLocal) => void;
  aoFechar: () => void;
}

export function FolhaAdicionarItem({
  visivel,
  candidatos,
  jaNaLista,
  aoAdicionar,
  aoFechar,
}: FolhaAdicionarItemProps) {
  const { c } = useTema();
  const [busca, setBusca] = useState('');

  // Só produtos identificados na base: sem id canônico não há comparação entre
  // lojas, que é a razão de a lista existir.
  const comparaveis = candidatos.filter((p) => p.produtoCanonicoId != null);
  const resultados = filtrarPorNome(comparaveis, busca).slice(0, 30);

  function fechar() {
    setBusca('');
    aoFechar();
  }

  return (
    <FolhaInferior
      visivel={visivel}
      titulo="Adicionar à lista"
      aoFechar={fechar}
      rotuloFechar="Concluir"
    >
      <Texto cor="fraco" tamanho="xs" style={estilos.apoio}>
        Busque o produto e toque para adicionar
      </Texto>

      <View style={[estilos.busca, { backgroundColor: c.superficie, borderColor: c.borda }]}>
        <IconeBusca tamanho={18} cor={c.fraco} />
        <TextInput
          value={busca}
          onChangeText={setBusca}
          placeholder="ex.: sabão, café, arroz…"
          placeholderTextColor={c.fraco}
          autoCorrect={false}
          style={[estilos.buscaInput, { color: c.tinta }]}
        />
      </View>

      {comparaveis.length === 0 ? (
        <Texto cor="fraco" tamanho="sm" centralizado style={estilos.vazio}>
          Você ainda não tem produtos identificados na base. Escaneie um cupom para começar.
        </Texto>
      ) : resultados.length === 0 ? (
        <Texto cor="fraco" tamanho="sm" centralizado style={estilos.vazio}>
          Nenhum produto com esse nome no seu histórico.
        </Texto>
      ) : (
        resultados.map((p, idx) => {
          const dentro = p.produtoCanonicoId != null && jaNaLista.has(p.produtoCanonicoId);
          return (
            <Pressable
              key={p.chave}
              onPress={() => !dentro && aoAdicionar(p)}
              disabled={dentro}
              accessibilityRole="button"
              accessibilityLabel={dentro ? `${p.nome} já está na lista` : `Adicionar ${p.nome}`}
              style={({ pressed }) => [
                estilos.linha,
                idx < resultados.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: c.linha,
                },
                (pressed || dentro) && { opacity: 0.55 },
              ]}
            >
              <View style={[estilos.tile, { backgroundColor: c.linha }]}>
                <IconeLoja tamanho={16} cor={c.tinta} />
              </View>

              <View style={estilos.texto}>
                <Texto peso="semibold" tamanho="sm" numberOfLines={1}>
                  {p.nome}
                </Texto>
                <Texto cor="fraco" tamanho="xs" numerico>
                  {p.faixaPessoal?.mediana != null
                    ? `seu típico ${moeda(p.faixaPessoal.mediana)}${
                        p.unidadeBase ? `/${p.unidadeBase}` : ''
                      }`
                    : `${p.nObservacoes} ${p.nObservacoes === 1 ? 'compra' : 'compras'}`}
                </Texto>
              </View>

              <View style={[estilos.mais, { backgroundColor: dentro ? c.linha : c.teal }]}>
                <IconeMais tamanho={14} cor={dentro ? c.fraco : c.sobreTeal} larguraTraco={2.5} />
              </View>
            </Pressable>
          );
        })
      )}
    </FolhaInferior>
  );
}

const estilos = StyleSheet.create({
  apoio: { marginTop: -espaco.xs, marginBottom: espaco.md },
  busca: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm + 2,
    borderWidth: 1,
    borderRadius: raio.md,
    paddingHorizontal: 14,
    marginBottom: espaco.sm,
  },
  buscaInput: { flex: 1, paddingVertical: 0, fontSize: 13.5 },
  vazio: { paddingVertical: espaco.xxl, lineHeight: 19 },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: espaco.md,
    minHeight: 44,
  },
  tile: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: { flex: 1 },
  mais: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
