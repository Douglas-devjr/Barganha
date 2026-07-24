/**
 * Handoff 3a (`permloc`) — passo de REGIÃO da abertura. Explica por que o app
 * precisa saber onde você compra antes de pedir a escolha.
 *
 * O usuário escolhe COMO define a região: por GPS (detecta a cidade uma vez, sem
 * salvar a posição) ou manualmente. Os dois caminhos vivem em `EditorRegiao`; a
 * ação principal do priming abre esse seletor. O que PERSISTE é sempre só o
 * município/UF — a agregação de preço continua pela loja (CNPJ), nunca pelo
 * rastreio do usuário (decisão travada nº4).
 */

import { useState } from 'react';
import { StyleSheet } from 'react-native';

import {
  CabecalhoVoltar,
  corIconePainel,
  EditorRegiao,
  IconePino,
  PainelFoco,
  Tela,
  Texto,
} from '@/componentes';
import { espaco, useTema } from '@/tema';

export interface EscolherRegiaoTelaProps {
  /** Conclui a abertura (com região salva ou pulada). */
  aoConcluir: () => void;
}

export function EscolherRegiaoTela({ aoConcluir }: EscolherRegiaoTelaProps) {
  const { c } = useTema();
  const [escolhendo, setEscolhendo] = useState(false);

  if (escolhendo) {
    return (
      <Tela>
        <CabecalhoVoltar
          titulo="Sua região"
          subtitulo="Comparações de preço"
          aoVoltar={() => setEscolhendo(false)}
        />
        <EditorRegiao aoSalvar={aoConcluir} />
        <Texto
          cor="fraco"
          tamanho="xs"
          centralizado
          style={estilos.nota}
          onPress={aoConcluir}
          accessibilityRole="button"
        >
          Definir depois
        </Texto>
      </Tela>
    );
  }

  return (
    <PainelFoco
      icone={<IconePino tamanho={46} cor={corIconePainel(c, 'tinta')} larguraTraco={1.8} />}
      titulo="De onde são seus preços?"
      texto={
        'A comparação usa os cupons da sua região. Detecte sua cidade pelo GPS ou escolha ' +
        'manualmente — sua posição não é salva.'
      }
      acao={{ titulo: 'Escolher minha região', onPress: () => setEscolhendo(true) }}
      acaoSecundaria={{ titulo: 'Agora não', onPress: aoConcluir }}
      rodape="Dá para mudar quando quiser em Perfil → região."
    />
  );
}

const estilos = StyleSheet.create({
  nota: { marginTop: espaco.lg, textDecorationLine: 'underline', minHeight: 44 },
});
