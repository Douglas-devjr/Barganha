/** C5.4 — Barril da API + instância padrão pronta para o app. */

import { meta } from '@/dados';

import { ClienteApi } from './cliente';

export { ClienteApi, ErroApi } from './cliente';
export type { OpcoesClienteApi } from './cliente';
export { obterBaseUrl } from './config';

/**
 * Cliente padrão do app. O Bearer (usuarioId da conta anônima) é resolvido
 * preguiçosamente do SQLite a cada chamada privada — só após o boot ter
 * inicializado o banco e criado/recuperado a conta.
 */
export const clienteApi = new ClienteApi({
  obterToken: () => meta.obterUsuarioId(),
});
