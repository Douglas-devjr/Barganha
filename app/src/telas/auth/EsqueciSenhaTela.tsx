/**
 * C4.3.1 — Recuperação de senha. Envia o email de reset (Supabase Auth) e mostra
 * uma confirmação neutra — não revelamos se o email existe ou não (boa prática
 * de segurança; evita enumeração de contas).
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth';
import { Botao, CampoTexto, Tela } from '@/componentes';
import { espaco } from '@/tema';
import type { AuthStackParamList } from '@/navegacao/tipos';

import { CabecalhoAuth } from './CabecalhoAuth';

type Props = NativeStackScreenProps<AuthStackParamList, 'EsqueciSenha'>;

export function EsqueciSenhaTela({ navigation }: Props) {
  const { enviarResetSenha } = useAuth();
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string>();
  const [carregando, setCarregando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviar() {
    if (!email.trim()) return setErro('Informe seu email.');
    setErro(undefined);
    setCarregando(true);
    const r = await enviarResetSenha(email);
    setCarregando(false);
    // Mostramos a mesma confirmação mesmo em erro de email inexistente
    // (anti-enumeração); só erros de rede/limite viram mensagem.
    if (r.erro && !r.erro.toLowerCase().includes('email')) return setErro(r.erro);
    setEnviado(true);
  }

  if (enviado) {
    return (
      <Tela>
        <CabecalhoAuth
          titulo="Verifique seu email"
          apoio={`Se houver uma conta para ${email.trim()}, enviamos um link para redefinir a senha.`}
        />
        <Botao titulo="Voltar para o login" bloco onPress={() => navigation.navigate('Login')} />
      </Tela>
    );
  }

  return (
    <Tela>
      <CabecalhoAuth
        titulo="Recuperar senha"
        apoio="Informe seu email e enviaremos um link para criar uma nova senha."
      />

      <View style={estilos.form}>
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
          erro={erro}
        />
        <Botao titulo="Enviar link" bloco carregando={carregando} onPress={enviar} />
        <Botao
          titulo="Voltar"
          variante="fantasma"
          bloco
          desabilitado={carregando}
          onPress={() => navigation.goBack()}
        />
      </View>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  form: { gap: espaco.lg },
});
