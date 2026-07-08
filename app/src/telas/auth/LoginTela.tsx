/**
 * C4.3.1 — Login (email/senha + Google). Rota inicial do fluxo de auth, exibida
 * quando há consentimento mas não há sessão. O sucesso não navega: o
 * `onAuthStateChange` do AuthProvider atualiza a sessão e o gate troca para o app.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth';
import { Botao, CampoTexto, Tela, Texto } from '@/componentes';
import { espaco, useTema } from '@/tema';
import type { AuthStackParamList } from '@/navegacao/tipos';

import { CabecalhoAuth } from './CabecalhoAuth';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginTela({ navigation }: Props) {
  const { c } = useTema();
  const { entrarComSenha, entrarComGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string>();
  const [carregando, setCarregando] = useState(false);
  const [carregandoGoogle, setCarregandoGoogle] = useState(false);

  const ocupado = carregando || carregandoGoogle;

  async function entrar() {
    if (!email.trim() || !senha) {
      setErro('Preencha email e senha.');
      return;
    }
    setErro(undefined);
    setCarregando(true);
    const r = await entrarComSenha(email, senha);
    setCarregando(false);
    if (r.erro) setErro(r.erro);
  }

  async function google() {
    setErro(undefined);
    setCarregandoGoogle(true);
    const r = await entrarComGoogle();
    setCarregandoGoogle(false);
    if (r.erro) setErro(r.erro);
  }

  return (
    <Tela>
      <CabecalhoAuth
        titulo="Entrar"
        apoio="Acesse sua conta para registrar cupons e acompanhar seus preços."
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
          editable={!ocupado}
        />
        <CampoTexto
          rotulo="Senha"
          value={senha}
          onChangeText={setSenha}
          placeholder="••••••••"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
          textContentType="password"
          editable={!ocupado}
          erro={erro}
        />

        <Pressable
          onPress={() => navigation.navigate('EsqueciSenha')}
          disabled={ocupado}
          style={estilos.esqueci}
          accessibilityRole="button"
        >
          <Texto peso="semibold" cor="marca" tamanho="sm">
            Esqueci a senha
          </Texto>
        </Pressable>

        <Botao
          titulo="Entrar"
          bloco
          carregando={carregando}
          desabilitado={ocupado}
          onPress={entrar}
        />

        <View style={estilos.divisor}>
          <View style={[estilos.linha, { backgroundColor: c.borda }]} />
          <Texto cor="fraco" tamanho="sm">
            ou
          </Texto>
          <View style={[estilos.linha, { backgroundColor: c.borda }]} />
        </View>

        <Botao
          titulo="Entrar com Google"
          variante="secundario"
          bloco
          carregando={carregandoGoogle}
          desabilitado={ocupado}
          onPress={google}
        />
      </View>

      <View style={estilos.rodape}>
        <Texto cor="textoSuave">Não tem conta? </Texto>
        <Pressable
          onPress={() => navigation.navigate('Cadastro')}
          disabled={ocupado}
          accessibilityRole="button"
        >
          <Texto peso="bold" cor="marca">
            Criar conta
          </Texto>
        </Pressable>
      </View>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  form: { gap: espaco.lg },
  esqueci: { alignSelf: 'flex-end', marginTop: -espaco.xs },
  divisor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    marginVertical: espaco.xs,
  },
  linha: { flex: 1, height: 1 },
  rodape: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: espaco.xxl,
  },
});
