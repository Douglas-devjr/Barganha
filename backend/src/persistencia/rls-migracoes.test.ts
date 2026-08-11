/**
 * Guarda de CI das migrações, em duas frentes:
 *
 *  1. TODA tabela criada em `public` precisa ter RLS ligado por uma migração —
 *     explicitamente, no repositório.
 *  2. TODA função criada em `public` precisa ter o EXECUTE revogado de `public`
 *     (o papel implícito), não só de `anon`/`authenticated`.
 *
 * Por que estático (lendo os .sql) e não contra um banco: o CI não sobe Postgres,
 * e os furos que este teste fecha são justamente os de uma migração que esquece.
 * O event trigger `ensure_rls` é rede de segurança e depende de privilégio que
 * nem todo ambiente concede — não pode ser a única garantia.
 *
 * O risco do RLS é concreto e já aconteceu (ver 20260629130000): tabela criada
 * sem RLS fica legível e ESCREVÍVEL pela anon key, que vive dentro do app. No
 * pool isso fura o gate de anonimização (decisão travada nº3, docs/04); nas
 * tabelas privadas, expõe histórico de compras de todo mundo.
 *
 * O do EXECUTE também já aconteceu duas vezes (`sincronizar_alertas` sem revoke
 * nenhum; `consumir_rate_limit` revogando só de anon/authenticated): função em
 * Postgres NASCE com EXECUTE para `PUBLIC`, e anon/authenticated herdam de
 * PUBLIC — revogar dos dois papéis nomeados não tira nada. O PostgREST publica
 * o schema `public` como RPC, então o que sobra é endpoint aberto com a anon key.
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

/** Nomes de função criados em `public`. */
function funcoesCriadas(sql: string): string[] {
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)/g;
  return [...new Set([...sql.matchAll(re)].map((m) => m[1]!))];
}

/**
 * Revokes de EXECUTE que citam `public` na lista de papéis, nas duas formas do
 * repositório: a estática (`revoke execute on function f(...) from public, ...`)
 * e a dinâmica dos varredores (`proname in ('a','b')` + `format('revoke ... from
 * public, anon, authenticated')`).
 *
 * A lista de papéis termina em `;` na forma estática e em `'` na dinâmica.
 */
function funcoesComExecuteRevogadoDePublic(sql: string): Set<string> {
  const nomes = new Set<string>();

  const estatico =
    /revoke\s+(?:execute|all)\s+on\s+function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^)]*\)\s*from\s+([^;']+)/g;
  for (const m of sql.matchAll(estatico)) {
    if (/\bpublic\b/.test(m[2]!)) nomes.add(m[1]!);
  }

  // Varredor: casa o bloco inteiro para só creditar os `proname` cujo `format`
  // de fato revoga de `public` — um bloco que revogasse só de anon não vale.
  const dinamico = /proname\s+(?:in\s*\(([^)]*)\)|=\s*'([a-z_][a-z0-9_]*)')([\s\S]{0,400}?)\$\$/g;
  for (const m of sql.matchAll(dinamico)) {
    const corpo = m[3]!;
    if (!/revoke\s+(?:execute|all)\s+on\s+function[^']*from\s+public\b/.test(corpo)) continue;
    const lista = m[1] ?? `'${m[2]!}'`;
    for (const nome of lista.matchAll(/'([a-z_][a-z0-9_]*)'/g)) nomes.add(nome[1]!);
  }

  return nomes;
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

describe('EXECUTE das funções nas migrações', () => {
  const sql = sqlDasMigracoes();

  it('encontra as funções e os revokes (sanidade dos regex)', () => {
    // Sem isto, um regex que parasse de casar faria o teste abaixo passar vazio.
    expect(funcoesCriadas(sql)).toContain('processar_cupom');
    expect(funcoesCriadas(sql).length).toBeGreaterThanOrEqual(10);
    const revogadas = funcoesComExecuteRevogadoDePublic(sql);
    expect(revogadas).toContain('processar_cupom'); // forma dinâmica (varredor)
    expect(revogadas).toContain('handle_new_user'); // forma estática
  });

  it('revoga o EXECUTE de `public` em toda função criada em public', () => {
    const revogadas = funcoesComExecuteRevogadoDePublic(sql);
    const abertas = funcoesCriadas(sql).filter((f) => !revogadas.has(f));
    expect(
      abertas,
      `Função(ões) sem "revoke execute ... from public": ${abertas.join(', ')}. ` +
        'Toda função nasce com EXECUTE para PUBLIC e o PostgREST publica o schema ' +
        '`public` como RPC, então isso é endpoint aberto à anon key do APK. ' +
        'Revogar só de anon/authenticated NÃO basta: os dois herdam de PUBLIC.',
    ).toEqual([]);
  });

  it('nenhum revoke de função esquece `public` na lista de papéis', () => {
    // O erro real que motivou a guarda: `from anon, authenticated` sem `public`
    // parece correto na revisão e não revoga nada.
    const re = /revoke\s+(?:execute|all)\s+on\s+function\s+([^;']+?)\s+from\s+([^;']+)/g;
    const incompletos = [...sql.matchAll(re)]
      .filter((m) => /\b(anon|authenticated)\b/.test(m[2]!) && !/\bpublic\b/.test(m[2]!))
      .map((m) => `${m[1]!.trim()} → from ${m[2]!.trim()}`);
    expect(incompletos, `Revoke(s) sem \`public\`: ${incompletos.join(' · ')}`).toEqual([]);
  });
});
