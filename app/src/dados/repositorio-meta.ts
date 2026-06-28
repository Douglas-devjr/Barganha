/**
 * C5.3 — Metadados locais (tabela chave/valor). Guarda o cursor do delta sync
 * (docs/05) e o id da conta anônima usado como Bearer (C4.3).
 *
 * NOTA (C4.3.1): o `usuarioId` é hoje a própria credencial. Guardá-lo aqui é
 * aceitável para o esqueleto, mas o endurecimento (mover para SecureStore /
 * token com segredo) está mapeado no catálogo de etapas.
 */

import { getBd } from './bd';

const CHAVE_CURSOR = 'cursor_delta';
const CHAVE_USUARIO = 'usuario_id';

export async function obterMeta(chave: string): Promise<string | null> {
  const linha = await getBd().getFirstAsync<{ valor: string | null }>(
    `SELECT valor FROM meta_sync WHERE chave = ?`,
    [chave],
  );
  return linha?.valor ?? null;
}

export async function definirMeta(chave: string, valor: string): Promise<void> {
  await getBd().runAsync(`INSERT OR REPLACE INTO meta_sync (chave, valor) VALUES (?, ?)`, [
    chave,
    valor,
  ]);
}

export const obterCursorDelta = (): Promise<string | null> => obterMeta(CHAVE_CURSOR);
export const definirCursorDelta = (cursor: string): Promise<void> =>
  definirMeta(CHAVE_CURSOR, cursor);

export const obterUsuarioId = (): Promise<string | null> => obterMeta(CHAVE_USUARIO);
export const definirUsuarioId = (id: string): Promise<void> => definirMeta(CHAVE_USUARIO, id);
