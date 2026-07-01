/**
 * C4.3.1 — Armazenamento da sessão do Supabase Auth sobre o SQLite local
 * (`expo-sqlite`, que JÁ é nativo no app). Evita adicionar um módulo nativo novo
 * (AsyncStorage) só para guardar o token: reusa a tabela chave/valor `meta_sync`,
 * com prefixo para não colidir com o cursor de sync / consentimento.
 *
 * Defensivo: se o banco ainda não foi inicializado (alguma operação muito cedo
 * no boot), trata como "sem valor" em vez de quebrar — o supabase-js re-tenta na
 * próxima operação, e o AuthProvider só monta depois do banco pronto (App.tsx).
 */

import { getBd } from '@/dados';

const PREFIXO = 'auth:';

export interface ArmazenamentoChaveValor {
  getItem(chave: string): Promise<string | null>;
  setItem(chave: string, valor: string): Promise<void>;
  removeItem(chave: string): Promise<void>;
}

export const armazenamentoSessao: ArmazenamentoChaveValor = {
  async getItem(chave) {
    try {
      const linha = await getBd().getFirstAsync<{ valor: string | null }>(
        `SELECT valor FROM meta_sync WHERE chave = ?`,
        [PREFIXO + chave],
      );
      return linha?.valor ?? null;
    } catch {
      return null;
    }
  },
  async setItem(chave, valor) {
    try {
      await getBd().runAsync(`INSERT OR REPLACE INTO meta_sync (chave, valor) VALUES (?, ?)`, [
        PREFIXO + chave,
        valor,
      ]);
    } catch {
      // Banco ainda não pronto — supabase-js re-tenta na próxima operação.
    }
  },
  async removeItem(chave) {
    try {
      await getBd().runAsync(`DELETE FROM meta_sync WHERE chave = ?`, [PREFIXO + chave]);
    } catch {
      // ignora
    }
  },
};
