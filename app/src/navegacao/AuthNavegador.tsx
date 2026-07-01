/**
 * C4.3.1 — Stack de autenticação. Renderizado pelo gate (App.tsx) quando há
 * consentimento mas não há sessão. Login é a rota inicial; cadastro e
 * recuperação de senha são empilhados.
 */

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CadastroTela } from '@/telas/auth/CadastroTela';
import { EsqueciSenhaTela } from '@/telas/auth/EsqueciSenhaTela';
import { LoginTela } from '@/telas/auth/LoginTela';

import type { AuthStackParamList } from './tipos';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavegador() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginTela} />
      <Stack.Screen name="Cadastro" component={CadastroTela} />
      <Stack.Screen name="EsqueciSenha" component={EsqueciSenhaTela} />
    </Stack.Navigator>
  );
}
