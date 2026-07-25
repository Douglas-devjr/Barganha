/**
 * C4.3.1 — Cadastro (email/senha). Após criar a conta, o backend pode exigir
 * confirmação de email (configuração do projeto): nesse caso mostramos um aviso
 * e o usuário volta para o login. Se a confirmação estiver desligada, a sessão
 * já vem pronta e o gate troca para o app automaticamente.
 *
 * LGPD (docs/04): coletamos só email + senha — o mínimo para autenticar. O
 * consentimento sobre os preços anônimos já foi dado no onboarding.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth';
import { Botao, CampoTexto, Tela, Texto } from '@/componentes';
import { espaco } from '@/tema';
import type { AuthStackParamList } from '@/navegacao/tipos';

import { CabecalhoAuth } from './CabecalhoAuth';

type Props = NativeStackScreenProps<AuthStackParamList, 'Cadastro'>;

const MIN_SENHA = 6;

export function CadastroTela({ navigation }: Props) {
  const { cadastrar } = useAuth();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState<string>();
  const [carregando, setCarregando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function criar() {
    if (!email.trim()) return setErro('Informe seu email.');
    if (senha.length < MIN_SENHA)
      return setErro(`A senha precisa ter ao menos ${MIN_SENHA} caracteres.`);
    if (senha !== confirmar) return setErro('As senhas não conferem.');

    setErro(undefined);
    setCarregando(true);
    const r = await cadastrar(email, senha, nome);
    setCarregando(false);
    if (r.erro) return setErro(r.erro);
    if (r.precisaConfirmarEmail) setEnviado(true);
    // Sem confirmação: a sessão já existe → o gate troca para o app sozinho.
  }

  if (enviado) {
    return (
      <Tela>
        <CabecalhoAuth
          titulo="Confirme seu email"
          apoio={`Enviamos um link de confirmação para ${email.trim()}. Abra-o para ativar sua conta e depois entre.`}
        />
        <Botao titulo="Voltar para o login" bloco onPress={() => navigation.navigate('Login')} />
      </Tela>
    );
  }

  return (
    <Tela>
      <CabecalhoAuth
        titulo="Criar conta"
        apoio="É rápido. Só precisamos de um email e uma senha."
      />

      <View style={estilos.form}>
        {/*
          Opcional de propósito: pedir o nome como obrigatório seria coletar dado
          pessoal sem necessidade (minimização, docs/04). Ele existe só para o app
          conseguir cumprimentar a pessoa — sem ele a saudação é neutra.
        */}
        <CampoTexto
          rotulo="Como quer ser chamado? (opcional)"
          value={nome}
          onChangeText={setNome}
          placeholder="Seu primeiro nome"
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          editable={!carregando}
        />
        <CampoTexto
          rotulo="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="voce@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          editable={!carregando}
        />
        <CampoTexto
          rotulo="Senha"
          value={senha}
          onChangeText={setSenha}
          placeholder={`No mínimo ${MIN_SENHA} caracteres`}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password-new"
          textContentType="newPassword"
          editable={!carregando}
        />
        <CampoTexto
          rotulo="Confirmar senha"
          value={confirmar}
          onChangeText={setConfirmar}
          placeholder="Repita a senha"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password-new"
          textContentType="newPassword"
          editable={!carregando}
          erro={erro}
        />

        <Botao titulo="Criar conta" bloco carregando={carregando} onPress={criar} />
      </View>

      <View style={estilos.rodape}>
        <Texto cor="textoSuave">Já tem conta? </Texto>
        <Pressable
          onPress={() => navigation.navigate('Login')}
          disabled={carregando}
          accessibilityRole="button"
        >
          <Texto peso="bold" cor="marca">
            Entrar
          </Texto>
        </Pressable>
      </View>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  form: { gap: espaco.lg },
  rodape: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: espaco.xxl,
  },
});
