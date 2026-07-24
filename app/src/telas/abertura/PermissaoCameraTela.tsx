/**
 * Handoff 3a (`permcam`) — priming da permissão de câmera. Explica POR QUE o app
 * precisa dela ANTES de o sistema perguntar: quem entende o motivo aceita; quem
 * é surpreendido pelo diálogo do Android nega, e negar duas vezes bloqueia de
 * vez (aí só nos ajustes).
 *
 * Dois estados, como no protótipo:
 *   • priming — ícone na tinta, "Permitir câmera";
 *   • negada  — ícone apagado, "Abrir ajustes" + a saída "Digitar chave".
 *
 * O estado negado não é decorativo: é o `canAskAgain === false` do expo-camera.
 */

import { useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { Linking } from 'react-native';

import { corIconePainel, IconeCamera, PainelFoco, useToast } from '@/componentes';
import { useTema } from '@/tema';

export interface PermissaoCameraTelaProps {
  /** Segue o fluxo de abertura (permitindo, negando ou pulando). */
  aoConcluir: () => void;
  /** Alternativa de quem não vai liberar a câmera: digitar a chave da NFC-e. */
  aoDigitarChave: () => void;
}

export function PermissaoCameraTela({ aoConcluir, aoDigitarChave }: PermissaoCameraTelaProps) {
  const { c } = useTema();
  const toast = useToast();
  const [permissao, requisitar] = useCameraPermissions();
  const [pedindo, setPedindo] = useState(false);

  // Já concedida: nada a pedir — o gate de abertura segue adiante.
  // `canAskAgain === false` é o bloqueio definitivo do sistema.
  const bloqueada = permissao != null && !permissao.granted && !permissao.canAskAgain;
  const tom = bloqueada ? 'apagado' : 'tinta';

  async function pedir() {
    if (bloqueada) {
      await Linking.openSettings();
      return;
    }
    setPedindo(true);
    const r = await requisitar();
    setPedindo(false);
    // Concedida OU negada com possibilidade de pedir de novo: seguimos. O app
    // funciona sem câmera (chave digitada), então não travamos ninguém aqui.
    if (r.granted || r.canAskAgain) aoConcluir();
  }

  return (
    <PainelFoco
      icone={<IconeCamera tamanho={46} cor={corIconePainel(c, tom)} larguraTraco={1.8} />}
      tom={tom}
      titulo={bloqueada ? 'Câmera bloqueada' : 'Precisamos da câmera'}
      texto={
        bloqueada
          ? 'Sem acesso à câmera não dá para ler o QR Code dos cupons. Você pode liberar nos ' +
            'ajustes do celular.'
          : 'É com a câmera que a Barganha lê o QR Code da NFC-e. Usamos só durante o ' +
            'escaneamento — nada é gravado.'
      }
      acao={{
        titulo: bloqueada ? 'Abrir ajustes' : 'Permitir câmera',
        carregando: pedindo,
        onPress: () => {
          if (bloqueada) toast('Abrindo os ajustes do sistema…');
          void pedir();
        },
      }}
      acaoSecundaria={{
        titulo: bloqueada ? 'Digitar chave manualmente' : 'Agora não',
        onPress: bloqueada ? aoDigitarChave : aoConcluir,
      }}
    />
  );
}
