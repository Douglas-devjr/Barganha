/**
 * Handoff 3a (`sheet:addItem`) + C7.6 — bottom-sheet de busca ao vivo para pôr
 * um produto na lista de compras.
 *
 * Duas fontes (docs/20): o CATÁLOGO LOCAL (o que o usuário já comprou, offline e
 * instantâneo) e o catálogo REGIONAL (o pool anônimo da região dele, online e
 * com debounce). Antes só existia a primeira — e por isso quem acabava de criar
 * conta abria este sheet e via um vazio, sem nada para adicionar.
 *
 * Sem texto digitado e sem histórico, mostramos os POPULARES da região: é o
 * primeiro conteúdo real que uma conta nova encontra no app.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  buscarNaRegiao,
  comparaveis,
  filtrarLocais,
  mesclar,
  type ProdutoBuscavel,
} from '@/nucleo/busca-produtos';
import type { ProdutoLocal } from '@/nucleo/catalogo';
import { moeda } from '@/nucleo/formato';
import { espaco, raio, useTema } from '@/tema';

import { FolhaInferior } from './FolhaInferior';
import { IconeBusca, IconeLoja, IconeMais } from './icones';
import { Texto } from './Texto';

/** Espera depois da última tecla antes de consultar a região. */
const DEBOUNCE_MS = 350;

/** Teto de linhas renderizadas — o sheet não é uma lista infinita. */
const MAX_LINHAS = 30;

export interface FolhaAdicionarItemProps {
  visivel: boolean;
  /** Catálogo local já carregado pela tela (evita recarregar a cada abertura). */
  candidatos: readonly ProdutoLocal[];
  /** Ids já na lista — aparecem marcados e não podem ser adicionados de novo. */
  jaNaLista: ReadonlySet<string>;
  aoAdicionar: (produto: ProdutoBuscavel) => void;
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
  const [regionais, setRegionais] = useState<ProdutoBuscavel[]>([]);
  const [carregandoRegiao, setCarregandoRegiao] = useState(false);

  const locais = filtrarLocais(candidatos, busca);
  const temHistorico = comparaveis(candidatos).length > 0;

  /**
   * Consulta a região com debounce. O `rodada` descarta resposta atrasada: sem
   * ele, o resultado de "arr" podia chegar depois do de "arroz" e sobrescrevê-lo.
   */
  const rodada = useRef(0);
  const consultarRegiao = useCallback((termo: string) => {
    const minha = ++rodada.current;
    setCarregandoRegiao(true);
    void buscarNaRegiao(termo)
      .then((r) => {
        if (rodada.current === minha) setRegionais(r);
      })
      .finally(() => {
        if (rodada.current === minha) setCarregandoRegiao(false);
      });
  }, []);

  useEffect(() => {
    if (!visivel) return;
    const timer = setTimeout(() => consultarRegiao(busca), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [visivel, busca, consultarRegiao]);

  const resultados = mesclar(locais, regionais).slice(0, MAX_LINHAS);

  function fechar() {
    setBusca('');
    setRegionais([]);
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
        {carregandoRegiao ? <ActivityIndicator size="small" color={c.fraco} /> : null}
      </View>

      {/* Sem histórico, o que está na tela é o catálogo da região — dizer isso
          evita a leitura de que o app "já sabe" o que a pessoa compra. */}
      {!temHistorico && resultados.length > 0 ? (
        <Texto cor="fraco" tamanho="xs" style={estilos.apoioRegiao}>
          {busca ? 'Produtos da sua região' : 'Mais vistos na sua região'}
        </Texto>
      ) : null}

      {resultados.length === 0 ? (
        <Texto cor="fraco" tamanho="sm" centralizado style={estilos.vazio}>
          {carregandoRegiao
            ? 'Buscando na sua região…'
            : busca
              ? 'Nenhum produto com esse nome no seu histórico nem na sua região.'
              : 'Ainda não há produtos com preço na sua região. Escaneie um cupom para começar a ' +
                'base — o seu e o de todo mundo.'}
        </Texto>
      ) : (
        resultados.map((p, idx) => {
          const dentro = jaNaLista.has(p.produtoCanonicoId);
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
                  {apoio(p)}
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

/**
 * Linha de apoio de cada resultado. O rótulo diz de onde vem o número — "seu
 * típico" é o histórico da pessoa; "típico na região" é o pool. Colapsar os dois
 * num só número esconderia a diferença entre "eu pago isso" e "por aqui custa isso".
 */
function apoio(p: ProdutoBuscavel): string {
  const sufixo = p.unidadeBase ? `/${p.unidadeBase}` : '';
  if (p.tipico == null) return 'sem preço típico ainda';
  return p.origem === 'historico'
    ? `seu típico ${moeda(p.tipico)}${sufixo}`
    : `típico na região ${moeda(p.tipico)}${sufixo}`;
}

const estilos = StyleSheet.create({
  apoio: { marginTop: -espaco.xs, marginBottom: espaco.md },
  apoioRegiao: { marginTop: espaco.sm, marginBottom: -espaco.xs },
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
