/**
 * Handoff 3a (`regiao`) — Perfil → região. A tela é só a moldura; o miolo é o
 * `EditorRegiao`, compartilhado com o passo de região da abertura.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { CabecalhoVoltar, EditorRegiao, Tela } from '@/componentes';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'EditarRegiao'>;

export function EditarRegiaoTela({ navigation }: Props) {
  return (
    <Tela>
      <CabecalhoVoltar
        titulo="Editar região"
        subtitulo="Comparações de preço"
        aoVoltar={() => navigation.goBack()}
      />
      <EditorRegiao aoSalvar={() => navigation.goBack()} />
    </Tela>
  );
}
