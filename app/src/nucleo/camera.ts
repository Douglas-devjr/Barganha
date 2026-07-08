/**
 * Estado "a câmera pode rodar": tela FOCADA + app em PRIMEIRO PLANO. No Android,
 * a `CameraView` deve ser DESMONTADA fora dessas condições — mantê-la montada com
 * o app em segundo plano deixa o preview PRETO ao voltar (a sessão nativa não
 * retoma sozinha, e o prop `active` do expo-camera é iOS-only nesta versão).
 * Desmontar/remontar força a reabertura da câmera e cura o preview preto.
 */

import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

function emPrimeiroPlano(estado: AppStateStatus | null): boolean {
  // `unknown`/null só ocorrem no arranque, antes do primeiro evento — trata como
  // ativo para não segurar a câmera à toa.
  return estado == null || estado === 'active' || estado === 'unknown';
}

export function useCameraAtiva(): boolean {
  const focada = useIsFocused();
  const [appAtivo, setAppAtivo] = useState(() => emPrimeiroPlano(AppState.currentState));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) =>
      setAppAtivo(emPrimeiroPlano(estado)),
    );
    return () => sub.remove();
  }, []);

  return focada && appAtivo;
}
