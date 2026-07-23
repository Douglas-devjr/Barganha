/**
 * C4.3.1 — Armazenamento da sessão do Supabase Auth.
 *
 * O valor guardado aqui é a sessão inteira: access token E **refresh token**, que
 * é de longa duração e vale uma conta. Por isso ele vive no armazenamento
 * seguro do sistema (Keystore no Android, Keychain no iOS) via
 * `expo-secure-store`, não em texto puro no SQLite do app — onde um aparelho com
 * root, ou um backup do diretório do app, o entregaria de graça.
 *
 * DOIS CUIDADOS que o SecureStore impõe:
 *  • Teto de ~2 KB por valor. A sessão do Supabase passa disso com folga (o JWT
 *    sozinho já é grande), então gravamos em PEDAÇOS e remontamos na leitura.
 *  • É módulo nativo. Um dev build antigo pode não tê-lo — então ele é
 *    carregado SOB DEMANDA e, se faltar, caímos no SQLite (mesmo padrão do
 *    `expo-web-browser` no contexto de auth). O app continua funcionando; a
 *    proteção extra entra no próximo build.
 *
 * MIGRAÇÃO: na primeira leitura após a atualização, a sessão que estiver no
 * SQLite é movida para o SecureStore e apagada da origem — ninguém precisa
 * fazer login de novo, e o token não fica para trás em claro.
 */

import { getBd } from '@/dados';
import { log } from '@/nucleo/log';

const PREFIXO = 'auth:';

/** Margem sob o teto de 2048 bytes do SecureStore (chave + metadados cabem). */
const TAM_PEDACO = 1800;

export interface ArmazenamentoChaveValor {
  getItem(chave: string): Promise<string | null>;
  setItem(chave: string, valor: string): Promise<void>;
  removeItem(chave: string): Promise<void>;
}

type ModuloSecureStore = typeof import('expo-secure-store');

// `null` = já tentamos e o módulo nativo não existe neste build.
let moduloSecureStore: ModuloSecureStore | null | undefined;

/** Carrega o SecureStore uma vez; `null` se o build não o tiver. */
async function secureStore(): Promise<ModuloSecureStore | null> {
  if (moduloSecureStore !== undefined) return moduloSecureStore;
  try {
    const mod = await import('expo-secure-store');
    // `isAvailableAsync` cobre o caso do módulo existir mas o sistema não
    // oferecer armazenamento seguro (raro; alguns Android antigos).
    moduloSecureStore = (await mod.isAvailableAsync()) ? mod : null;
  } catch {
    moduloSecureStore = null;
  }
  return moduloSecureStore;
}

/**
 * Chave equivalente no cofre. O SecureStore só aceita `[A-Za-z0-9._-]` e LANÇA
 * em qualquer outra coisa — o `:` do PREFIXO derrubava toda leitura e escrita,
 * jogando a sessão no fallback do SQLite sem ninguém perceber. Prefixo próprio
 * (o do SQLite continua `auth:`, que já está gravado em disco) e o resto do
 * nome saneado, para a chave sobreviver ao que o supabase-js resolver usar.
 */
const chaveCofre = (chave: string): string => `auth_${chave.replace(/[^A-Za-z0-9._-]/g, '_')}`;

/** Chave do enésimo pedaço de um valor fatiado. */
const chavePedaco = (chave: string, i: number): string => `${chaveCofre(chave)}__${i}`;

// ── Fallback: a tabela chave/valor do SQLite (comportamento anterior) ──────

const sqlite: ArmazenamentoChaveValor = {
  async getItem(chave) {
    try {
      const linha = await getBd().getFirstAsync<{ valor: string | null }>(
        `SELECT valor FROM meta_sync WHERE chave = ?`,
        [PREFIXO + chave],
      );
      return linha?.valor ?? null;
    } catch (erro) {
      // Silêncio aqui significa o usuário sendo deslogado sem explicação —
      // "sem sessão" e "não consegui ler a sessão" são coisas MUITO diferentes.
      log.falha('warn', { action: 'sessao.leitura_sqlite' }, erro, 'Falha ao ler sessão do SQLite');
      return null;
    }
  },
  async setItem(chave, valor) {
    try {
      await getBd().runAsync(`INSERT OR REPLACE INTO meta_sync (chave, valor) VALUES (?, ?)`, [
        PREFIXO + chave,
        valor,
      ]);
    } catch (erro) {
      // Banco ainda não pronto — supabase-js re-tenta na próxima operação.
      log.falha('warn', { action: 'sessao.escrita_sqlite' }, erro, 'Falha ao gravar sessão');
    }
  },
  async removeItem(chave) {
    try {
      await getBd().runAsync(`DELETE FROM meta_sync WHERE chave = ?`, [PREFIXO + chave]);
    } catch (erro) {
      log.falha('warn', { action: 'sessao.remocao_sqlite' }, erro, 'Falha ao remover sessão');
    }
  },
};

// ── SecureStore, com fatiamento ───────────────────────────────────────────

/** Nº de pedaços gravados para a chave (0 = nada aqui). */
async function lerContagem(mod: ModuloSecureStore, chave: string): Promise<number> {
  const bruto = await mod.getItemAsync(chaveCofre(chave));
  const n = bruto == null ? 0 : Number(bruto);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function apagarSeguro(mod: ModuloSecureStore, chave: string): Promise<void> {
  const total = await lerContagem(mod, chave);
  for (let i = 0; i < total; i++) {
    await mod.deleteItemAsync(chavePedaco(chave, i));
  }
  await mod.deleteItemAsync(chaveCofre(chave));
}

/**
 * Sessão do Supabase Auth. Prefere o armazenamento seguro do sistema; cai no
 * SQLite quando o módulo nativo não está no build (ver cabeçalho).
 *
 * Defensivo em todo lugar: qualquer falha vira "sem valor" em vez de exceção —
 * o supabase-js simplesmente re-tenta na próxima operação, e o AuthProvider só
 * monta depois do banco pronto (App.tsx).
 */
export const armazenamentoSessao: ArmazenamentoChaveValor = {
  async getItem(chave) {
    const mod = await secureStore();
    if (!mod) return sqlite.getItem(chave);

    try {
      const total = await lerContagem(mod, chave);
      if (total > 0) {
        const partes: string[] = [];
        for (let i = 0; i < total; i++) {
          const parte = await mod.getItemAsync(chavePedaco(chave, i));
          // Pedaço faltando = valor corrompido; melhor "sem sessão" (o usuário
          // refaz o login) do que devolver um JSON truncado ao supabase-js.
          if (parte == null) {
            await apagarSeguro(mod, chave);
            return null;
          }
          partes.push(parte);
        }
        return partes.join('');
      }

      // Nada no cofre: migra o que houver do armazenamento antigo (uma vez).
      const legado = await sqlite.getItem(chave);
      if (legado == null) return null;
      await armazenamentoSessao.setItem(chave, legado);
      await sqlite.removeItem(chave);
      return legado;
    } catch (erro) {
      // Cofre ilegível = usuário deslogado do nada. É a causa mais provável de
      // um "sumiu minha sessão" e antes não deixava nenhum rastro.
      log.falha('error', { action: 'sessao.leitura_cofre' }, erro, 'Falha ao ler sessão do cofre');
      return null;
    }
  },

  async setItem(chave, valor) {
    const mod = await secureStore();
    if (!mod) return sqlite.setItem(chave, valor);

    try {
      // Apaga antes de gravar: uma sessão nova menor deixaria pedaços órfãos da
      // anterior, e a contagem seria a única coisa a apontar para eles.
      await apagarSeguro(mod, chave);
      const pedacos: string[] = [];
      for (let i = 0; i < valor.length; i += TAM_PEDACO) {
        pedacos.push(valor.slice(i, i + TAM_PEDACO));
      }
      for (let i = 0; i < pedacos.length; i++) {
        await mod.setItemAsync(chavePedaco(chave, i), pedacos[i]!);
      }
      // A contagem por ÚLTIMO: até ela existir, a leitura vê "nada gravado" em
      // vez de um valor pela metade.
      await mod.setItemAsync(chaveCofre(chave), String(pedacos.length));
    } catch (erro) {
      // Cofre indisponível — não deixa o usuário sem sessão por causa disso.
      // Mas o fallback é para o SQLite, ou seja, o refresh token deixa de ficar
      // no armazenamento seguro: é degradação de SEGURANÇA e precisa aparecer.
      log.falha(
        'error',
        { action: 'sessao.cofre_indisponivel' },
        erro,
        'Cofre indisponível — sessão caiu para o SQLite (sem proteção do Keystore)',
      );
      await sqlite.setItem(chave, valor);
    }
  },

  async removeItem(chave) {
    const mod = await secureStore();
    // Limpa os DOIS lados: pode haver resquício do armazenamento antigo se a
    // migração não chegou a rodar para esta chave.
    if (mod) {
      try {
        await apagarSeguro(mod, chave);
      } catch (erro) {
        // Falhar aqui deixa credencial no cofre depois de um logout. O SQLite
        // ainda é limpo abaixo, mas isto não pode passar despercebido.
        log.falha(
          'error',
          { action: 'sessao.remocao_cofre' },
          erro,
          'Falha ao apagar sessão do cofre no logout',
        );
      }
    }
    await sqlite.removeItem(chave);
  },
};
