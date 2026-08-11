-- Auditoria — fecha o EXECUTE público de `sincronizar_alertas` (C8.4).
--
-- Funções em Postgres nascem com `EXECUTE` para `PUBLIC`, e `anon`/
-- `authenticated` HERDAM de PUBLIC. `20260724090000` revogou routines de
-- anon/authenticated, mas revogar dos papéis nomeados não mexe na concessão de
-- PUBLIC: `has_function_privilege('anon', ..., 'execute')` segue true, e o
-- PostgREST expõe o schema `public` como RPC (`/rest/v1/rpc/<nome>`). Por isso
-- todas as irmãs levam `from public, anon, authenticated` (20260722110000,
-- 20260729100000, 20260805090000) — `sincronizar_alertas` nasceu em
-- 20260801140000 sem nenhum revoke e ficou de fora do padrão.
--
-- Hoje isso NÃO é explorável: a função é SECURITY INVOKER e `alerta_preco` tem
-- RLS com política própria (`usuario_id = auth.uid()`, com `with check`), então
-- passar o `p_usuario_id` de outra pessoa não apaga nem grava nada dela. Mas a
-- proteção fica inteiramente dependente de essa política nunca afrouxar — e o
-- parâmetro `p_usuario_id` é exatamente a forma que um dia se tornaria um
-- IDOR. Mesmo racional (e mesmas palavras) de `processar_cupom` em
-- 20260722110000: só a service role, que ignora grants, chama esta RPC.
--
-- Forma dinâmica para casar a assinatura exata sem depender dos type modifiers
-- e para não falhar em ambiente onde um overload antigo ainda exista.
--
-- Depende de: 20260801140000 (a função).

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'sincronizar_alertas'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.assinatura);
  end loop;
end
$$;

-- E o `search_path` não estava pinado (advisor 0011) — as irmãs já estão desde
-- 20260629130000/20260722110000. Sem pinar, quem chamar a função com outro
-- `search_path` decide qual `alerta_preco` ela enxerga.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'sincronizar_alertas'
  loop
    execute format('alter function %s set search_path = public', r.assinatura);
  end loop;
end
$$;
