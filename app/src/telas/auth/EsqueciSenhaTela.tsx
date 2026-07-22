/**
 * C4.3.1 + Redesign "3a" — Recuperação de senha. Envia o email de reset
 * (Supabase Auth) e volta ao login com um toast.
 *
 * O toast é neutro de propósito — não revela se o email existe ou não (evita
 * enumeração de contas). Por isso ele aparece igual nos dois casos, e só erro de
 * rede/limite vira mensagem no campo.
 *
 * Layout do handoff: botão voltar circular, título 27/700, apoio, um campo e o
 * botão primário; "Voltar para o login" como link.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth';
import { Botao, CampoTexto, IconeVoltar, Tela, Texto, useToast } from '@/componentes';
import { espaco, raio, useTema } from '@/tema';
import type { AuthStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<AuthStackParamList, 'EsqueciSenha'>;

export function EsqueciSenhaTela({ navigation }: Props) {
  const { c } = useTema();
  const toast = useToast();
  const { enviarResetSenha } = useAuth();
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string>();
  const [carregando, setCarregando] = useState(false);

  async function enviar() {
    if (!email.trim()) return setErro('Informe seu email.');
    setErro(undefined);
    setCarregando(true);
    const r = await enviarResetSenha(email);
    setCarregando(false);
    // Só erro de rede/limite vira mensagem; "email inexistente" segue o caminho
    // de sucesso para não confirmar a existência da conta.
    if (r.erro && !r.erro.toLowerCase().includes('email')) return setErro(r.erro);
    toast('Link de redefinição enviado');
    navigation.navigate('Login');
  }

  return (
    <Tela>
      <Pressable
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        style={[estilos.voltar, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }]}
      >
        <IconeVoltar tamanho={19} cor={c.tinta} />
      </Pressable>

      <Texto peso="bold" style={estilos.titulo}>
        Recuperar senha
      </Texto>
      <Texto cor="suave" style={estilos.apoio}>
        Enviamos um link de redefinição para o seu e-mail cadastrado.
      </Texto>

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
          editable={!carregando}
          erro={erro}
        />
        <Botao titulo="Enviar link de redefinição" bloco carregando={carregando} onPress={enviar} />
        <Pressable
          onPress={() => navigation.navigate('Login')}
          disabled={carregando}
          accessibilityRole="button"
          style={estilos.link}
        >
          <Texto cor="suave" peso="semibold" tamanho="sm">
            Voltar para o login
          </Texto>
        </Pressable>
      </View>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  voltar: {
    width: 44,
    height: 44,
    borderRadius: raio.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: espaco.sm,
  },
  titulo: { fontSize: 27, letterSpacing: -0.8, marginTop: espaco.xl },
  apoio: { fontSize: 13.5, lineHeight: 20, marginTop: espaco.xs, marginBottom: espaco.xl },
  form: { gap: espaco.lg },
  link: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
});
