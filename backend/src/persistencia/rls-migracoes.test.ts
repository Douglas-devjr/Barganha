/**
 * Guarda de CI: TODA tabela criada em `public` pelas migrações precisa ter RLS
 * ligado por uma migração — explicitamente, no repositório.
 *
 * Por que estático (lendo os .sql) e não contra um banco: o CI não sobe Postgres,
 * e o furo que este teste fecha é justamente o de uma migração que esquece o RLS.
 * O event trigger `ensure_rls` é rede de segurança e depende de privilégio que
 * nem todo ambiente concede — não pode ser a única garantia.
 *
 * O risco é concreto e já aconteceu (ver 20260629130000): tabela criada sem RLS
 * fica legível e ESCREVÍVEL pela anon key, que vive dentro do app. No pool isso
 * fura o gate de anonimização (decisão travada nº3, docs/04); nas tabelas
 * privadas, expõe histórico de compras de todo mundo.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR_MIGRACOES = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

function sqlDasMigracoes(): string {
  return readdirSync(DIR_MIGRACOES)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(DIR_MIGRACOES, f), 'utf8'))
    .join('\n')
    .toLowerCase();
}

/** Nomes de tabela criados em `public` (o schema padrão das migrações). */
function tabelasCriadas(sql: string): string[] {
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/g;
  return [...new Set([...sql.matchAll(re)].map((m) => m[1]!))];
}

/** Tabelas com `alter table ... enable row level security`. */
function tabelasComRls(sql: string): Set<string> {
  const re =
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/g;
  return new Set([...sql.matchAll(re)].map((m) => m[1]!));
}

describe('RLS nas migrações', () => {
  const sql = sqlDasMigracoes();

  it('encontra as migrações e as tabelas do domínio', () => {
    // Sanidade: se os regex pararem de casar (mudança de estilo do SQL), o teste
    // abaixo passaria vazio e daria falsa segurança.
    const tabelas = tabelasCriadas(sql);
    expect(tabelas).toContain('observacao_preco');
    expect(tabelas).toContain('cupom');
    expect(tabelas.length).toBeGreaterThanOrEqual(10);
  });

  it('liga RLS em toda tabela criada em public', () => {
    const comRls = tabelasComRls(sql);
    const semRls = tabelasCriadas(sql).filter((t) => !comRls.has(t));
    expect(
      semRls,
      `Tabela(s) sem "enable row level security" em nenhuma migração: ${semRls.join(', ')}. ` +
        'Sem RLS elas ficam abertas à anon key, que vive dentro do app. ' +
        'Acrescente o alter table na migração que cria a tabela.',
    ).toEqual([]);
  });
});
