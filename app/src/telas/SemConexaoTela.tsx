/**
 * Handoff 3a (`offline`) — estado de rede ausente. Tranquiliza: os cupons já
 * escaneados ficam salvos e sincronizam quando a conexão volta (offline-first é
 * decisão travada nº7).
 *
 * É uma tela empilhável, aberta pelos fluxos que PRECISAM de rede e a perderam
 * (ex.: a comparação por loja). O que funciona offline — escanear, consultar o
 * cache — nunca cai aqui.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { corIconePainel, IconeSemWifi, PainelFoco } from '@/componentes';
import type { RootStackParamList } from '@/navegacao/tipos';
import { useTema } from '@/tema';

type Props = NativeStackScreenProps<RootStackParamList, 'SemConexao'>;

export function SemConexaoTela({ navigation }: Props) {
  const { c } = useTema();

  return (
    <PainelFoco
      icone={<IconeSemWifi tamanho={40} cor={corIconePainel(c, 'apagado')} larguraTraco={1.8} />}
      tom="apagado"
      redondo
      titulo="Você está sem conexão"
      texto={
        'A Barganha precisa de internet para comparar preços com a base colaborativa. Verifique o ' +
        'Wi-Fi ou os dados móveis.'
      }
      acao={{ titulo: 'Tentar de novo', onPress: () => navigation.goBack() }}
      rodape="Seus cupons já escaneados ficam salvos e sincronizam quando a conexão voltar."
    />
  );
}
