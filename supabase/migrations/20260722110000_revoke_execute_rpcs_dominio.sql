-- Auditoria — fecha o EXECUTE público das RPCs de domínio.
--
-- Funções em Postgres nascem com `EXECUTE` para `PUBLIC`, e o PostgREST expõe
-- o schema `public` como RPC (`/rest/v1/rpc/<nome>`). `processar_cupom` e
-- `aprovar_lancamento_manual` escrevem no POOL COMPARTILHADO — são exatamente o
-- caminho que a camada de anonimização monopoliza (decisão travada #3).
--
-- Hoje isso NÃO é explorável: ambas são SECURITY INVOKER, então escrevem com os
-- privilégios de quem chama, e o pool está com RLS ligada e sem política (nega
-- tudo para anon/authenticated). Mas a proteção fica inteiramente dependente de
-- ninguém jamais adicionar uma política de escrita no pool — e as outras
-- funções do projeto (`handle_new_user`, `rls_auto_enable`,
-- `incrementar_telemetria_parsing`) já receberam este mesmo revoke. Fecha a
-- inconsistência: só a service role (que ignora grants) chama estas RPCs.
--
-- Forma dinâmica para casar a assinatura exata sem depender dos type modifiers
-- (char(2), numeric etc.) e para não falhar em ambiente onde um overload antigo
-- ainda exista.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('processar_cupom', 'aprovar_lancamento_manual')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.assinatura);
  end loop;
end
$$;

-- `aprovar_lancamento_manual` também não tinha o search_path pinado (advisor
-- 0011) — a irmã `processar_cupom` já tem, desde 20260629130000.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'aprovar_lancamento_manual'
  loop
    execute format('alter function %s set search_path = public', r.assinatura);
  end loop;
end
$$;
