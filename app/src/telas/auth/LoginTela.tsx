/**
 * C4.3.1 + Redesign "3a" — Login (email/senha + Google). Rota inicial do fluxo
 * de auth, exibida quando há consentimento mas não há sessão. O sucesso não
 * navega: o `onAuthStateChange` do AuthProvider atualiza a sessão e o gate troca
 * para o app.
 *
 * Layout do handoff: painel superior de TINTA (logo "B" em quadrado `fundo` +
 * headline 36/700/-1.4 em `fundo`) e folha `fundo` de raio 28 sobreposta, com os
 * campos. O painel é full-bleed — por isso a tela não usa `Tela`, que aplica o
 * padding padrão.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth';
import { Botao, CampoTexto, Texto } from '@/componentes';
import { espaco, raio, useTema } from '@/tema';
import type { AuthStackParamList } from '@/navegacao/tipos';

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
    <View style={[estilos.raiz, { backgroundColor: c.tinta }]}>
      <KeyboardAvoidingView
        style={estilos.raiz}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={estilos.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* painel de tinta */}
          <SafeAreaView edges={['top']}>
            <View style={estilos.painel}>
              <View style={[estilos.logo, { backgroundColor: c.fundo }]}>
                <Texto peso="bold" style={[estilos.logoLetra, { color: c.tinta }]}>
                  B
                </Texto>
              </View>
              <Texto peso="bold" style={[estilos.headline, { color: c.fundo }]}>
                Saiba se o preço vale a barganha.
              </Texto>
            </View>
          </SafeAreaView>

          {/* folha */}
          <View style={[estilos.folha, { backgroundColor: c.fundo }]}>
            <View style={estilos.form}>
              <CampoTexto
                rotulo="E-mail"
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
                senha
                value={senha}
                onChangeText={setSenha}
                placeholder="••••••••"
                autoCapitalize="none"
                autoComplete="password"
                textContentType="password"
                editable={!ocupado}
                erro={erro}
              />

              <Pressable
                onPress={() => navigation.navigate('EsqueciSenha')}
                disabled={ocupado}
                accessibilityRole="button"
                hitSlop={8}
                style={estilos.esqueci}
              >
                <Texto peso="semibold" tamanho="sm" style={estilos.link}>
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
                <View style={[estilos.risco, { backgroundColor: c.borda }]} />
                <Texto cor="fraco" tamanho="sm" peso="semibold">
                  OU
                </Texto>
                <View style={[estilos.risco, { backgroundColor: c.borda }]} />
              </View>

              <Botao
                titulo="Continuar com Google"
                variante="secundario"
                bloco
                carregando={carregandoGoogle}
                desabilitado={ocupado}
                onPress={google}
              />
            </View>

            <View style={estilos.rodape}>
              <Texto cor="suave" tamanho="sm">
                Primeira vez aqui?{' '}
              </Texto>
              <Pressable
                onPress={() => navigation.navigate('Cadastro')}
                disabled={ocupado}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Texto peso="bold" tamanho="sm" style={estilos.link}>
                  Criar conta grátis
                </Texto>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1 },
  scroll: { flexGrow: 1 },
  painel: { paddingHorizontal: espaco.tela, paddingTop: espaco.xxl, paddingBottom: 40 },
  logo: {
    width: 58,
    height: 58,
    borderRadius: raio.cartao,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetra: { fontSize: 28 },
  headline: { fontSize: 36, lineHeight: 41, letterSpacing: -1.4, marginTop: espaco.xxl },
  folha: {
    flex: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: espaco.tela,
    paddingTop: espaco.xl,
    paddingBottom: espaco.xxl,
  },
  form: { gap: espaco.lg },
  esqueci: { alignSelf: 'flex-end', marginTop: -espaco.sm },
  link: { textDecorationLine: 'underline' },
  divisor: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  risco: { flex: 1, height: 1 },
  rodape: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: espaco.xl,
  },
});
