/**
 * Redesign "3a" — Notificações. Lê o feed LOCAL (`dados/repositorio-notificacoes`),
 * alimentado a cada foco do Início por `nucleo/notificacoes`. Agrupa em HOJE /
 * ESTA SEMANA / ANTES, marca o não-lido com o ponto `caro` e traz "Marcar lidas".
 *
 * O feed é privado e derivado: nasce dos alertas e selos do próprio aparelho,
 * nunca do pool anônimo (docs/04).
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  CabecalhoVoltar,
  Cartao,
  Estado,
  IconeSino,
  IconeTendenciaBaixo,
  IconeTrofeu,
  Tela,
  Texto,
} from '@/componentes';
import { notificacoes } from '@/dados';
import type { Notificacao } from '@/dados/repositorio-notificacoes';
import { espaco, raio, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'Notificacoes'>;

/** Seções do handoff: hoje, esta semana, e o resto. */
type Secao = { titulo: string; itens: Notificacao[] };

const DIA_MS = 24 * 60 * 60 * 1000;

function agrupar(lista: Notificacao[], agora = new Date()): Secao[] {
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const inicioSemana = inicioHoje - 6 * DIA_MS;

  const hoje: Notificacao[] = [];
  const semana: Notificacao[] = [];
  const antes: Notificacao[] = [];

  for (const n of lista) {
    const t = new Date(n.criadoEm).getTime();
    if (Number.isNaN(t)) antes.push(n);
    else if (t >= inicioHoje) hoje.push(n);
    else if (t >= inicioSemana) semana.push(n);
    else antes.push(n);
  }

  return [
    { titulo: 'HOJE', itens: hoje },
    { titulo: 'ESTA SEMANA', itens: semana },
    { titulo: 'ANTES', itens: antes },
  ].filter((s) => s.itens.length > 0);
}

export function NotificacoesTela({ navigation }: Props) {
  const { c } = useTema();
  const [lista, setLista] = useState<Notificacao[]>([]);
  const [carregado, setCarregado] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      void notificacoes.listar().then((l) => {
        if (!ativo) return;
        setLista(l);
        setCarregado(true);
      });
      return () => {
        ativo = false;
      };
    }, []),
  );

  async function marcarLidas() {
    await notificacoes.marcarTodasLidas();
    setLista(await notificacoes.listar());
  }

  function abrir(n: Notificacao) {
    void notificacoes.marcarLida(n.id);
    setLista((atual) =>
      atual.map((x) => (x.id === n.id ? { ...x, lidaEm: new Date().toISOString() } : x)),
    );
    if (n.produtoCanonicoId) {
      navigation.navigate('ProdutoDetalhe', { chave: n.produtoCanonicoId, nome: n.titulo });
    }
  }

  const temNaoLida = lista.some((n) => n.lidaEm == null);
  const secoes = agrupar(lista);

  return (
    <Tela>
      <View style={estilos.topo}>
        <View style={{ flex: 1 }}>
          <CabecalhoVoltar titulo="Notificações" aoVoltar={() => navigation.goBack()} />
        </View>
        {temNaoLida ? (
          <Pressable onPress={() => void marcarLidas()} accessibilityRole="button" hitSlop={8}>
            <Texto peso="bold" tamanho="sm" cor="suave">
              Marcar lidas
            </Texto>
          </Pressable>
        ) : null}
      </View>

      {carregado && lista.length === 0 ? (
        <Estado
          icone={<IconeSino tamanho={30} cor={c.tinta} />}
          titulo="Nada por aqui ainda"
          texto={
            'Quando um produto que você acompanha baixar de preço — ou você desbloquear uma ' +
            'conquista — o aviso aparece aqui.'
          }
        />
      ) : (
        secoes.map((secao) => (
          <View key={secao.titulo} style={estilos.secao}>
            <Texto peso="semibold" cor="fraco" style={estilos.secaoTitulo}>
              {secao.titulo}
            </Texto>
            <Cartao semPadding>
              {secao.itens.map((n, idx) => (
                <Pressable
                  key={n.id}
                  onPress={() => abrir(n)}
                  accessibilityRole="button"
                  style={[estilos.item, idx > 0 && { borderTopWidth: 1, borderTopColor: c.linha }]}
                >
                  <View style={[estilos.tile, { backgroundColor: c.tealWash }]}>
                    <IconeDoTipo tipo={n.tipo} cor={c.tinta} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Texto peso="semibold" tamanho="sm" numberOfLines={2}>
                      {n.titulo}
                    </Texto>
                    {n.subtitulo ? (
                      <Texto cor="fraco" tamanho="xs" style={{ marginTop: 2 }}>
                        {n.subtitulo}
                      </Texto>
                    ) : null}
                  </View>
                  {n.lidaEm == null ? (
                    <View style={[estilos.ponto, { backgroundColor: c.caro }]} />
                  ) : null}
                </Pressable>
              ))}
            </Cartao>
          </View>
        ))
      )}
    </Tela>
  );
}

function IconeDoTipo({ tipo, cor }: { tipo: Notificacao['tipo']; cor: string }) {
  if (tipo === 'conquista') return <IconeTrofeu tamanho={18} cor={cor} />;
  if (tipo === 'resumo_mes') return <IconeSino tamanho={18} cor={cor} />;
  return <IconeTendenciaBaixo tamanho={18} cor={cor} />;
}

const estilos = StyleSheet.create({
  topo: { flexDirection: 'row', alignItems: 'flex-start', gap: espaco.md },
  secao: { marginBottom: espaco.lg },
  secaoTitulo: { fontSize: 11, letterSpacing: 1.3, marginBottom: espaco.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    padding: espaco.lg,
    minHeight: 44,
  },
  tile: {
    width: 36,
    height: 36,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ponto: { width: 8, height: 8, borderRadius: 4 },
});
