/**
 * Redesign "3a" — contexto de tema. Troca o objeto de paleta (`claro`/`escuro`)
 * e expõe `useTema()`. Inicia pela preferência do sistema (`Appearance`) e deixa
 * um `alternar()` para um toggle manual (ex.: no Perfil).
 *
 * Regra de ouro: nenhum componente usa hex fixo — tudo vem de `c` (a paleta ativa).
 *
 * `TemaFixo` fixa uma paleta para uma subárvore. Existe por causa das
 * superfícies que são escuras nos DOIS temas (o overlay da câmera): sem ele, o
 * botão primário do tema claro é quase-preto e some sobre o overlay escuro.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance } from 'react-native';

import { claro, escuro, type Paleta } from './cores';

export interface Tema {
  /** Paleta ativa. */
  c: Paleta;
  /** `true` no modo escuro. */
  escuro: boolean;
  /** Alterna claro/escuro (uso manual). */
  alternar: () => void;
  /** Fixa o modo (ou volta a seguir o sistema com `null`). */
  definir: (modo: 'claro' | 'escuro' | null) => void;
}

const Ctx = createContext<Tema>({
  c: claro,
  escuro: false,
  alternar: () => {},
  definir: () => {},
});

export const useTema = () => useContext(Ctx);

export function ProvedorTema({ children }: { children: ReactNode }) {
  // `null` = seguir o sistema; 'claro'/'escuro' = escolha manual do usuário.
  const [modo, setModo] = useState<'claro' | 'escuro' | null>(null);
  const [sistema, setSistema] = useState(() => Appearance.getColorScheme() ?? 'light');

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) =>
      setSistema(colorScheme ?? 'light'),
    );
    return () => sub.remove();
  }, []);

  const dark = modo ? modo === 'escuro' : sistema === 'dark';

  const alternar = useCallback(() => setModo(dark ? 'claro' : 'escuro'), [dark]);
  const definir = useCallback((m: 'claro' | 'escuro' | null) => setModo(m), []);

  const valor = useMemo<Tema>(
    () => ({ c: dark ? escuro : claro, escuro: dark, alternar, definir }),
    [dark, alternar, definir],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/**
 * Fixa a paleta de uma subárvore, ignorando o tema do app. Use em superfícies
 * que são escuras (ou claras) nos dois temas — ex.: o overlay da câmera:
 *
 *   <TemaFixo modo="escuro">…</TemaFixo>
 *
 * `alternar`/`definir` continuam valendo para o app inteiro.
 */
export function TemaFixo({ modo, children }: { modo: 'claro' | 'escuro'; children: ReactNode }) {
  const pai = useContext(Ctx);
  const dark = modo === 'escuro';
  const valor = useMemo<Tema>(
    () => ({ ...pai, c: dark ? escuro : claro, escuro: dark }),
    [pai, dark],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
