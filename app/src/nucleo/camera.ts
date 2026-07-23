/**
 * Estado da câmera para as telas de captura (QR do cupom e código de barras).
 *
 * `useCameraAtiva` — "a câmera pode rodar": tela FOCADA + app em PRIMEIRO PLANO.
 * No Android a `CameraView` deve ser DESMONTADA fora dessas condições: mantê-la
 * montada com o app em segundo plano deixa o preview PRETO ao voltar (a sessão
 * nativa não retoma sozinha, e o prop `active` do expo-camera segue `@platform
 * ios` na v17 — conferido em node_modules/expo-camera/build/Camera.types.d.ts).
 *
 * `useCameraPronta` — junta permissão + atividade + erro de montagem num único
 * estado, e PEDE A PERMISSÃO SOZINHO na primeira vez. Sem isso, quem abre a tela
 * vê a moldura vazia e uma mensagem, sem entender que precisa tocar num botão —
 * parece que a câmera "não abriu".
 */

import { useIsFocused } from '@react-navigation/native';
import { useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
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

/** Em que passo a tela de câmera está — decide o que desenhar. */
export type EstadoCamera =
  /** Ainda resolvendo a permissão (evita piscar a tela de "permitir"). */
  | 'carregando'
  /** Tudo certo: pode montar a `CameraView`. */
  | 'pronta'
  /** Negada, mas ainda dá para pedir de novo pelo app. */
  | 'sem_permissao'
  /** Negada em definitivo: só nas configurações do sistema. */
  | 'bloqueada'
  /** A câmera falhou ao montar (`onMountError`). */
  | 'erro';

export interface CameraPronta {
  estado: EstadoCamera;
  /** Mensagem real do `onMountError` — exibida para não esconder a causa. */
  erro: string | null;
  /** Ligar na prop `onMountError` da `CameraView`. */
  aoFalhar: (mensagem: string) => void;
  /** Nova tentativa após erro: limpa e remonta a câmera. */
  tentarDeNovo: () => void;
  /** Pedido manual de permissão (botão), quando o automático não bastou. */
  pedirPermissao: () => void;
}

export function useCameraPronta(): CameraPronta {
  const [permissao, requisitar] = useCameraPermissions();
  const ativa = useCameraAtiva();
  const [erro, setErro] = useState<string | null>(null);
  /** O pedido automático roda UMA vez — repetir viraria laço com "negar". */
  const jaPediu = useRef(false);

  useEffect(() => {
    if (jaPediu.current || !permissao || permissao.granted || !permissao.canAskAgain) return;
    jaPediu.current = true;
    void requisitar();
  }, [permissao, requisitar]);

  const estado: EstadoCamera = !permissao
    ? 'carregando'
    : erro != null
      ? 'erro'
      : permissao.granted
        ? ativa
          ? 'pronta'
          : 'carregando' // fora de foco/segundo plano: desmonta sem alarmar
        : permissao.canAskAgain
          ? 'sem_permissao'
          : 'bloqueada';

  const aoFalhar = useCallback((mensagem: string) => {
    setErro(mensagem || 'A câmera não respondeu.');
  }, []);

  const tentarDeNovo = useCallback(() => setErro(null), []);

  const pedirPermissao = useCallback(() => {
    void requisitar();
  }, [requisitar]);

  return { estado, erro, aoFalhar, tentarDeNovo, pedirPermissao };
}
