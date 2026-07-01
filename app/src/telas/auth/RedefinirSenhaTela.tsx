/**
 * C4.3.1 — Nova senha após o link de "esqueci a senha". O deep link do email já
 * virou sessão (contexto de auth) e o gate (App.tsx) força esta tela até o
 * usuário salvar a nova senha — ou pular, mantendo a sessão do link.
 *
 * Renderizada fora dos navegadores (como o onboarding): não depende de rota.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth';
import { Botao, CampoTexto, Tela } from '@/componentes';
import { espaco } from '@/tema';

import { CabecalhoAuth } from './CabecalhoAuth';

const MIN_SENHA = 6;

export function RedefinirSenhaTela() {
  const { atualizarSenha, cancelarRecuperacao } = useAuth();
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState<string>();
  const [carregando, setCarregando] = useState(false);

  async function salvar() {
    if (senha.length < MIN_SENHA)
      return setErro(`A senha precisa ter ao menos ${MIN_SENHA} caracteres.`);
    if (senha !== confirmar) return setErro('As senhas não conferem.');

    setErro(undefined);
    setCarregando(true);
    const r = await atualizarSenha(senha);
    setCarregando(false);
    if (r.erro) return setErro(r.erro);
    // Sucesso: o contexto encerra a recuperação e o gate libera o app.
  }

  return (
    <Tela>
      <CabecalhoAuth
        titulo="Criar nova senha"
        apoio="Você entrou pelo link do email. Escolha a nova senha da sua conta."
      />

      <View style={estilos.form}>
        <CampoTexto
          rotulo="Nova senha"
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
          rotulo="Confirmar nova senha"
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

        <Botao titulo="Salvar nova senha" bloco carregando={carregando} onPress={salvar} />
        <Botao
          titulo="Agora não"
          variante="fantasma"
          bloco
          desabilitado={carregando}
          onPress={cancelarRecuperacao}
        />
      </View>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  form: { gap: espaco.lg },
});
