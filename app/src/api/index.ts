/** C5.4 — Barril da API + instância padrão pronta para o app. */

import { supabase } from '@/auth/supabase';

import { ClienteApi } from './cliente';

export { ClienteApi, ErroApi } from './cliente';
export type { OpcoesClienteApi } from './cliente';
export { obterBaseUrl } from './config';

/**
 * Cliente padrão do app. O Bearer é o access token (JWT) da sessão do Supabase
 * Auth (C4.3.1), resolvido preguiçosamente a cada chamada privada. O supabase-js
 * renova o token sozinho (autoRefreshToken); sem sessão → `null` → 401.
 */
export const clienteApi = new ClienteApi({
  obterToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});
