/**
 * C5.3 — Metadados locais (tabela chave/valor). Guarda o cursor do delta sync
 * (docs/05) e o consentimento LGPD do onboarding (C6.4).
 *
 * NOTA (C4.3.1): a credencial deixou de morar aqui — o Bearer agora é o JWT da
 * sessão do Supabase Auth, gerido pelo supabase-js (ver src/auth/).
 */

import { getBd } from './bd';

const CHAVE_CURSOR = 'cursor_delta';
/** Chave do consentimento LGPD. Exportada p/ a limpeza local preservá-la (nucleo/conta). */
export const CHAVE_CONSENTIMENTO = 'consentimento_em';
const CHAVE_LOCAL_UF = 'local_uf';
const CHAVE_LOCAL_MUNICIPIO = 'local_municipio';

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

/**
 * C6.4 — Consentimento LGPD do onboarding. Guarda o instante (ISO) em que o
 * usuário concordou; ausente = onboarding ainda não concluído. É o gate que
 * decide a rota inicial (onboarding vs. abas) no boot.
 */
export const obterConsentimentoEm = (): Promise<string | null> => obterMeta(CHAVE_CONSENTIMENTO);
export const registrarConsentimento = (): Promise<void> =>
  definirMeta(CHAVE_CONSENTIMENTO, new Date().toISOString());

/**
 * Localização ESCOLHIDA manualmente pelo usuário (cidade/UF) — o recorte
 * geográfico das consultas/sync de preço da região. Mora só aqui, no aparelho;
 * nunca viaja junto com dado privado e serve apenas para recortar a consulta
 * anônima (decisão travada #4: geo pela loja, sem rastrear o usuário). `municipio`
 * é opcional (UF já dá o fallback). Ausente = ainda não escolheu (cai na UF
 * derivada do histórico).
 */
export interface LocalEscolhido {
  uf: string;
  municipio?: string;
}

export async function obterLocalEscolhido(): Promise<LocalEscolhido | null> {
  const [uf, municipio] = await Promise.all([
    obterMeta(CHAVE_LOCAL_UF),
    obterMeta(CHAVE_LOCAL_MUNICIPIO),
  ]);
  if (!uf) return null;
  return { uf, ...(municipio ? { municipio } : {}) };
}

export async function definirLocalEscolhido(local: LocalEscolhido): Promise<void> {
  await definirMeta(CHAVE_LOCAL_UF, local.uf);
  await definirMeta(CHAVE_LOCAL_MUNICIPIO, local.municipio?.trim() ?? '');
}
