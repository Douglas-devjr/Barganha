/**
 * Redesign "3a" — bottom-sheet: entra deslizando de baixo (280ms) sobre um véu,
 * cantos de 22px no topo. Base dos três sheets do handoff (ações do item,
 * filtros/ordenação e denúncia de preço).
 *
 * Fecha por toque no véu, pelo botão Cancelar e pelo voltar do Android (o
 * `Modal` já cuida do último). O conteúdo é livre — quem usa monta as linhas.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { espaco, raio, sombra, useTema } from '@/tema';

import { Botao } from './Botao';
import { DURACAO, useDuracao } from './movimento';
import { Texto } from './Texto';

export interface FolhaInferiorProps {
  visivel: boolean;
  titulo: string;
  /** Ação textual à direita do título (ex.: "Limpar" nos filtros). */
  acaoTitulo?: { rotulo: string; onPress: () => void };
  aoFechar: () => void;
  /** Rótulo do botão de baixo; `null` remove o botão. */
  rotuloFechar?: string | null;
  children: ReactNode;
}

export function FolhaInferior({
  visivel,
  titulo,
  acaoTitulo,
  aoFechar,
  rotuloFechar = 'Cancelar',
  children,
}: FolhaInferiorProps) {
  const { c } = useTema();
  const insets = useSafeAreaInsets();
  const duracao = useDuracao(DURACAO.folha);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visivel) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: duracao, useNativeDriver: true }).start();
  }, [anim, duracao, visivel]);

  return (
    <Modal visible={visivel} transparent animationType="none" onRequestClose={aoFechar}>
      <Animated.View style={[estilos.veu, { backgroundColor: c.veu, opacity: anim }]}>
        <Pressable style={estilos.veuToque} onPress={aoFechar} accessibilityLabel="Fechar" />
      </Animated.View>

      <View style={estilos.ancora} pointerEvents="box-none">
        <Animated.View
          style={[
            estilos.folha,
            sombra.folha,
            {
              backgroundColor: c.cartao,
              paddingBottom: Math.max(insets.bottom, espaco.lg),
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) },
              ],
            },
          ]}
        >
          <View style={[estilos.puxador, { backgroundColor: c.borda }]} />

          <View style={estilos.cabecalho}>
            <Texto peso="bold" tamanho="lg" style={{ flex: 1 }} numberOfLines={1}>
              {titulo}
            </Texto>
            {acaoTitulo ? (
              <Pressable onPress={acaoTitulo.onPress} accessibilityRole="button" hitSlop={8}>
                <Texto peso="bold" tamanho="sm" cor="suave">
                  {acaoTitulo.rotulo}
                </Texto>
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            style={estilos.corpo}
            contentContainerStyle={estilos.corpoConteudo}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>

          {rotuloFechar ? (
            <Botao titulo={rotuloFechar} variante="secundario" bloco onPress={aoFechar} />
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Linha padrão de um sheet de ações (ícone opcional + rótulo). */
export function LinhaFolha({
  rotulo,
  onPress,
  destrutiva = false,
  icone,
  comBorda = true,
}: {
  rotulo: string;
  onPress: () => void;
  destrutiva?: boolean;
  icone?: ReactNode;
  comBorda?: boolean;
}) {
  const { c } = useTema();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[estilos.linha, comBorda && { borderBottomWidth: 1, borderBottomColor: c.linha }]}
    >
      {icone}
      <Texto peso="semibold" style={destrutiva ? { color: c.caro } : undefined}>
        {rotulo}
      </Texto>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  veu: { ...StyleSheet.absoluteFillObject },
  veuToque: { flex: 1 },
  ancora: { flex: 1, justifyContent: 'flex-end' },
  folha: {
    borderTopLeftRadius: raio.xl,
    borderTopRightRadius: raio.xl,
    paddingHorizontal: espaco.tela,
    paddingTop: espaco.md,
    maxHeight: '82%',
  },
  puxador: { width: 38, height: 4, borderRadius: raio.pill, alignSelf: 'center' },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    marginTop: espaco.lg,
    marginBottom: espaco.sm,
  },
  corpo: { flexGrow: 0 },
  corpoConteudo: { paddingBottom: espaco.md },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingVertical: espaco.lg,
    minHeight: 44,
  },
});
