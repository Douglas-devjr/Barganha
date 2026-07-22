/**
 * Redesign "3a" — Toast: pílula na tinta que sobe no rodapé e some sozinha
 * (~2.4s). Usado em alerta on/off, salvar edição, denúncia enviada, item
 * removido, cupom lido, notificações lidas.
 *
 * Vive num provider porque o toast é global (aparece acima da tab bar, venha de
 * onde vier). Quem dispara usa `useToast()`:
 *
 *   const toast = useToast();
 *   toast('Alterações salvas');
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { espaco, raio, useTema } from '@/tema';

import { DURACAO, useDuracao } from './movimento';
import { Texto } from './Texto';

const VISIVEL_MS = 2400;

type Disparar = (mensagem: string) => void;

const Ctx = createContext<Disparar>(() => {});

/** Dispara um toast. Fora do provider vira no-op (não quebra tela isolada). */
export const useToast = () => useContext(Ctx);

export function ProvedorToast({ children }: { children: ReactNode }) {
  const [mensagem, setMensagem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disparar = useCallback<Disparar>((texto) => {
    setMensagem(texto);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMensagem(null), VISIVEL_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <Ctx.Provider value={disparar}>
      {children}
      {mensagem != null ? <Pilula mensagem={mensagem} /> : null}
    </Ctx.Provider>
  );
}

function Pilula({ mensagem }: { mensagem: string }) {
  const { c } = useTema();
  const insets = useSafeAreaInsets();
  const duracao = useDuracao(DURACAO.toast);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: duracao, useNativeDriver: true }).start();
  }, [anim, duracao, mensagem]);

  return (
    <View
      // `none`: o toast é aviso, nunca intercepta toque.
      pointerEvents="none"
      style={[estilos.area, { bottom: insets.bottom + 84 }]}
    >
      <Animated.View
        style={[
          estilos.pilula,
          {
            backgroundColor: c.tinta,
            opacity: anim,
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            ],
          },
        ]}
      >
        <Texto peso="semibold" tamanho="sm" cor="sobreTeal" centralizado>
          {mensagem}
        </Texto>
      </Animated.View>
    </View>
  );
}

const estilos = StyleSheet.create({
  area: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: espaco.tela,
  },
  pilula: {
    borderRadius: raio.pill,
    paddingVertical: 11,
    paddingHorizontal: espaco.xl,
    maxWidth: '100%',
  },
});
