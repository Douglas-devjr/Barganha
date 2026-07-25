/**
 * Handoff 3a (`conta`) — Perfil → Configurações da conta: os dados pessoais que
 * o app guarda, os atalhos de edição e as ações destrutivas (sair e excluir).
 *
 * O protótipo lista nome, e-mail e TELEFONE. O app não pede telefone e não vai
 * inventar um campo só para preencher a tela: guardar dado pessoal a mais sem
 * uso é exatamente o que a minimização da LGPD proíbe (docs/04). A tela mostra
 * o que existe de verdade — e diz que é só isso.
 *
 * Sair e Excluir moram aqui (saíram do corpo do Perfil, como no handoff), com
 * os mesmos cuidados de antes: avisar sobre cupons ainda na fila antes do
 * logout e confirmar a exclusão em diálogo.
 *
 * Sair ≠ Excluir (docs/04): SAIR limpa só o espelho deste aparelho — o histórico
 * fica guardado na CONTA (no servidor) e é reidratado no próximo login (restore,
 * `nucleo/sincronizador`). EXCLUIR apaga a conta e todo o histórico, no aparelho
 * e no servidor, sem volta. Os diálogos deixam essa diferença explícita, porque
 * antes "Sair" parecia apagar tudo — e agora o contrato mudou.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { clienteApi } from '@/api';
import { useAuth } from '@/auth';
import {
  CabecalhoVoltar,
  CampoTexto,
  CartaoLista,
  Dialogo,
  Eyebrow,
  IconeCadeado,
  IconeLapis,
  IconeLixeira,
  IconeSair,
  LinhaLista,
  Tela,
  Texto,
  useToast,
} from '@/componentes';
import { fila } from '@/dados';
import type { RootStackParamList } from '@/navegacao/tipos';
import { espaco, useTema } from '@/tema';

type Props = NativeStackScreenProps<RootStackParamList, 'ConfiguracoesConta'>;

/** Política publicada (site/, GitHub Pages). */
const URL_PRIVACIDADE =
  'https://douglas-devjr.github.io/barganha-legal/politica-de-privacidade.html';

export function ConfiguracoesContaTela({ navigation }: Props) {
  const { c } = useTema();
  const toast = useToast();
  const { usuario, sair, definirNomeExibicao } = useAuth();

  const [dialogo, setDialogo] = useState<'sair' | 'conta' | null>(null);
  const [pendentesAoSair, setPendentesAoSair] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeInput, setNomeInput] = useState('');
  const [salvandoNome, setSalvandoNome] = useState(false);

  const metadados = usuario?.user_metadata ?? {};
  const nome = ((metadados.nome ?? metadados.full_name ?? metadados.name ?? '') as string).trim();

  async function salvarNome() {
    setSalvandoNome(true);
    const r = await definirNomeExibicao(nomeInput);
    setSalvandoNome(false);
    if (r.erro) return toast(r.erro);
    setEditandoNome(false);
    toast(nomeInput.trim() ? 'Nome atualizado' : 'Nome removido');
  }

  async function apagarConta() {
    setOcupado(true);
    try {
      await clienteApi.apagarConta();
      await sair();
    } catch {
      setOcupado(false);
      setDialogo(null);
      toast('Não foi possível apagar agora. Verifique a conexão.');
    }
  }

  return (
    <Tela>
      <CabecalhoVoltar
        titulo="Configurações da conta"
        subtitulo="Perfil"
        aoVoltar={() => navigation.goBack()}
      />

      <Eyebrow style={estilos.eyebrow}>Dados pessoais</Eyebrow>
      <CartaoLista>
        <Dado rotulo="Nome" valor={nome || 'Não informado'} />
        <Dado rotulo="E-mail" valor={usuario?.email ?? '—'} ultima />
      </CartaoLista>
      <Texto cor="fraco" tamanho="xs" style={estilos.nota}>
        É só isso que a Barganha guarda sobre você. Os preços que você compartilha entram anônimos e
        soltos, sem ligação com a sua conta.
      </Texto>

      <CartaoLista style={estilos.bloco}>
        <LinhaLista
          icone={<IconeLapis tamanho={18} cor={c.suave} />}
          titulo="Editar nome de exibição"
          chevron
          onPress={() => {
            setNomeInput(nome);
            setEditandoNome(true);
          }}
        />
        <LinhaLista
          icone={<IconeCadeado tamanho={18} cor={c.suave} />}
          titulo="Alterar senha"
          subtitulo="Enviamos um link para o seu e-mail"
          chevron
          onPress={() => {
            toast('Use “Esqueci a senha” na tela de login para redefinir.');
          }}
        />
        <LinhaLista
          icone={<IconeCadeado tamanho={18} cor={c.suave} />}
          titulo="Privacidade dos dados"
          chevron
          ultima
          onPress={() => void Linking.openURL(URL_PRIVACIDADE)}
        />
      </CartaoLista>

      <CartaoLista style={estilos.bloco}>
        <LinhaLista
          icone={<IconeSair tamanho={18} cor={c.suave} />}
          titulo="Sair da conta"
          onPress={() => {
            // Consulta a fila antes de abrir: o texto do diálogo muda se houver
            // cupom que ainda não subiu.
            void fila
              .contarPendentes()
              .then(setPendentesAoSair)
              .catch(() => setPendentesAoSair(0));
            setDialogo('sair');
          }}
        />
        <LinhaLista
          icone={<IconeLixeira tamanho={18} cor={c.caro} />}
          titulo="Excluir conta"
          destrutiva
          ultima
          onPress={() => setDialogo('conta')}
        />
      </CartaoLista>

      <Dialogo
        visivel={editandoNome}
        titulo="Como quer ser chamado?"
        mensagem="Só aparece para você, dentro do app. Deixe em branco para não usar nome."
        rotuloConfirmar="Salvar"
        destrutivo={false}
        ocupado={salvandoNome}
        aoConfirmar={() => void salvarNome()}
        aoCancelar={() => setEditandoNome(false)}
      >
        <CampoTexto
          rotulo="Nome"
          value={nomeInput}
          onChangeText={setNomeInput}
          placeholder="Seu primeiro nome"
          autoCapitalize="words"
          editable={!salvandoNome}
        />
      </Dialogo>

      <Dialogo
        visivel={dialogo === 'sair'}
        titulo="Sair da conta?"
        mensagem={
          (pendentesAoSair > 0
            ? `${pendentesAoSair} cupom(ns) ainda não foram enviados. Vamos tentar enviá-los ` +
              'agora; o que não subir será perdido. Conecte-se à internet antes, se puder. '
            : '') +
          'Seu histórico fica guardado na sua conta e volta quando você entrar de novo — aqui ' +
          'ou em outro aparelho. Este aparelho é limpo ao sair. Para apagar de vez, use Excluir conta.'
        }
        rotuloConfirmar="Sair"
        aoConfirmar={() => {
          setDialogo(null);
          void sair();
        }}
        aoCancelar={() => setDialogo(null)}
      />

      <Dialogo
        visivel={dialogo === 'conta'}
        titulo="Excluir conta?"
        mensagem={
          'Isto remove sua conta e todo o seu histórico, no aparelho e no servidor. Não dá para ' +
          'desfazer. Os preços que você já compartilhou são anônimos e soltos — seguem ajudando ' +
          'a comunidade, sem ligação com você (LGPD).'
        }
        rotuloConfirmar="Excluir conta"
        icone={<IconeLixeira tamanho={24} cor={c.caro} />}
        ocupado={ocupado}
        aoConfirmar={() => void apagarConta()}
        aoCancelar={() => setDialogo(null)}
      />
    </Tela>
  );
}

function Dado({
  rotulo,
  valor,
  ultima = false,
}: {
  rotulo: string;
  valor: string;
  ultima?: boolean;
}) {
  const { c } = useTema();
  return (
    <View style={[estilos.dado, !ultima && { borderBottomWidth: 1, borderBottomColor: c.linha }]}>
      <Texto cor="fraco" tamanho="xs">
        {rotulo}
      </Texto>
      <Texto peso="semibold" numberOfLines={1} style={estilos.dadoValor}>
        {valor}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  eyebrow: { marginBottom: espaco.sm },
  bloco: { marginTop: espaco.md },
  nota: { marginTop: espaco.sm, marginLeft: espaco.xs, lineHeight: 16 },
  dado: { paddingVertical: espaco.md },
  dadoValor: { fontSize: 14, marginTop: 3 },
});
