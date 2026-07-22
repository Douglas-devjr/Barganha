/**
 * Redesign "3a" — durações do handoff + respeito a "reduzir movimento".
 *
 * O handoff pede `prefers-reduced-motion`; em RN o equivalente é
 * `AccessibilityInfo.isReduceMotionEnabled`. `useMovimento()` devolve as
 * durações já zeradas quando a pessoa pediu menos movimento, então quem anima
 * não precisa saber do detalhe — só multiplica pelo que veio.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Durações do handoff 3a, em ms. */
export const DURACAO = {
  tela: 280, // scrIn
  overlay: 220, // ovIn
  folha: 280, // sheetUp
  dialogo: 220, // popIn
  toast: 250, // toastIn
} as const;

/** `true` quando o sistema pede movimento reduzido. */
export function useReduzirMovimento(): boolean {
  const [reduzir, setReduzir] = useState(false);

  useEffect(() => {
    let ativo = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (ativo) setReduzir(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduzir);
    return () => {
      ativo = false;
      sub.remove();
    };
  }, []);

  return reduzir;
}

/**
 * Duração efetiva de uma animação: 0 quando o sistema pede movimento reduzido
 * (o estado final continua o mesmo — só não há transição).
 */
export function useDuracao(base: number): number {
  return useReduzirMovimento() ? 0 : base;
}
