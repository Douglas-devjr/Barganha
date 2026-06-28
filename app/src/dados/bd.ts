/**
 * C5.3 — Abertura e migração do SQLite local (expo-sqlite). Singleton: o app
 * chama `inicializarBd()` uma vez no boot; o resto do código usa `getBd()`.
 *
 * Migração incremental por `PRAGMA user_version` (ver migracoes.ts). WAL ligado
 * para leituras concorrentes; foreign_keys ON para o ON DELETE CASCADE valer.
 */

import * as SQLite from 'expo-sqlite';

import { MIGRACOES } from './migracoes';

const NOME_BD = 'barganha.db';

let bd: SQLite.SQLiteDatabase | null = null;

export async function inicializarBd(): Promise<SQLite.SQLiteDatabase> {
  if (bd) return bd;
  const db = await SQLite.openDatabaseAsync(NOME_BD);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrar(db);
  bd = db;
  return db;
}

export function getBd(): SQLite.SQLiteDatabase {
  if (!bd) {
    throw new Error('SQLite não inicializado. Chame inicializarBd() no boot do app.');
  }
  return bd;
}

async function migrar(db: SQLite.SQLiteDatabase): Promise<void> {
  const linha = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let versao = linha?.user_version ?? 0;

  for (let i = versao; i < MIGRACOES.length; i++) {
    const sql = MIGRACOES[i]!;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
    });
    versao = i + 1;
    // PRAGMA não aceita bind param; interpolar um inteiro derivado do índice é seguro.
    await db.execAsync(`PRAGMA user_version = ${versao}`);
  }
}
