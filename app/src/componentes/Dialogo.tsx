/**
 * Redesign "3a" — diálogo de confirmação: pop central (220ms) com ícone, título,
 * mensagem e duas ações — Cancelar (contorno) + a ação destrutiva em `caro`.
 *
 * Substitui o `Alert.alert` nativo nos pontos do handoff (excluir produto,
 * apagar conta): o Alert do sistema não acompanha o tema nem a tipografia.
 */

import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';

import { espaco, raio, useTema } from '@/tema';

import { Botao } from './Botao';
import { IconeAlerta } from './icones';
import { DURACAO, useDuracao } from './movimento';
import { Texto } from './Texto';

export interface DialogoProps {
  visivel: boolean;
  titulo: string;
  mensagem: string;
  /** Rótulo da ação destrutiva (ex.: "Excluir", "Apagar conta"). */
  rotuloConfirmar: string;
  rotuloCancelar?: string;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  /** `false` deixa a ação com a cor padrão (confirmação não destrutiva). */
  destrutivo?: boolean;
  ocupado?: boolean;
  /**
   * Ícone do topo. O handoff usa o ícone CONTEXTUAL da ação (lixeira ao
   * excluir); o alerta genérico é só o padrão de quem não informa.
   */
  icone?: ReactNode;
}

export function Dialogo({
  visivel,
  titulo,
  mensagem,
  rotuloConfirmar,
  rotuloCancelar = 'Cancelar',
  aoConfirmar,
  aoCancelar,
  destrutivo = true,
  ocupado = false,
  icone,
}: DialogoProps) {
  const { c } = useTema();
  const duracao = useDuracao(DURACAO.dialogo);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visivel) return;
    anim.setValue(0);
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      // Mola curta imita o popIn do handoff; sem movimento, entra direto.
      ...(duracao === 0 ? { speed: 100, bounciness: 0 } : { speed: 18, bounciness: 6 }),
    }).start();
  }, [anim, duracao, visivel]);

  const corAcao = destrutivo ? c.caro : c.tinta;

  return (
    <Modal visible={visivel} transparent animationType="none" onRequestClose={aoCancelar}>
      <View style={[estilos.veu, { backgroundColor: c.veu }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={aoCancelar}
          accessibilityLabel="Fechar"
        />

        <Animated.View
          style={[
            estilos.caixa,
            {
              backgroundColor: c.cartao,
              borderColor: c.cartaoBorda,
              opacity: anim,
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
              ],
            },
          ]}
        >
          <View style={[estilos.circulo, { backgroundColor: destrutivo ? c.caroBg : c.tealWash }]}>
            {icone ?? <IconeAlerta tamanho={24} cor={corAcao} />}
          </View>

          <Texto peso="bold" tamanho="lg" centralizado style={{ marginTop: espaco.md }}>
            {titulo}
          </Texto>
          <Texto cor="suave" tamanho="sm" centralizado style={estilos.mensagem}>
            {mensagem}
          </Texto>

          <View style={estilos.acoes}>
            <Botao
              titulo={rotuloCancelar}
              variante="secundario"
              onPress={aoCancelar}
              style={estilos.acao}
            />
            <Pressable
              onPress={aoConfirmar}
              disabled={ocupado}
              accessibilityRole="button"
              style={({ pressed }) => [
                estilos.acao,
                estilos.destrutivo,
                { backgroundColor: corAcao, opacity: ocupado ? 0.6 : pressed ? 0.85 : 1 },
              ]}
            >
              <Texto peso="bold" tamanho="md" cor="branco">
                {rotuloConfirmar}
              </Texto>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  veu: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: espaco.tela },
  caixa: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    borderRadius: raio.cartao,
    borderWidth: 1,
    padding: espaco.xl,
  },
  circulo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mensagem: { marginTop: espaco.xs, lineHeight: 19 },
  acoes: { flexDirection: 'row', gap: espaco.md, marginTop: espaco.xl, alignSelf: 'stretch' },
  acao: { flex: 1 },
  destrutivo: {
    height: 54,
    borderRadius: raio.botao,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
