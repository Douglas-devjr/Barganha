-- C9.3.3 — Endurecimento de segurança (advisors do Supabase) + fim do drift de RLS.
--
-- Reúne as correções apontadas pelo linter de segurança do Supabase
-- (get_advisors). NÃO muda o comportamento da aplicação: o backend fala com o
-- banco pela SERVICE ROLE (ignora RLS) e nenhuma função troca de lógica.
--
-- 1) RLS EXPLÍCITO no pool/curadoria. No banco real já valia (via o event
--    trigger `ensure_rls`), mas isso vivia SÓ no banco — recriar a partir das
--    migrações (`supabase db reset`) deixava estas tabelas SEM RLS, abrindo
--    leitura/escrita direta pela anon key e furando o gate de anonimização
--    (CLAUDE.md decisão #3, docs/04). RLS ligado + sem política = nega tudo para
--    anon/authenticated; o pool é servido só pelo backend.
-- 2) Revoga o EXECUTE público da `rls_auto_enable` (SECURITY DEFINER) — advisors
--    0028/0029. Mantém o event trigger (rede de segurança que liga RLS em tabela
--    nova); só fecha o vetor de chamada via PostgREST.
-- 3) Fixa o search_path das RPCs `processar_cupom`/`aprovar_lancamento_manual`
--    (advisor 0011). São SECURITY INVOKER (rodam como a service role); pinar em
--    `public` remove a mutabilidade sem mudar a resolução de nomes de hoje.
-- 4) Move a extensão `pg_trgm` de `public` para `extensions` (advisor 0014). O
--    índice GIN trigram acompanha a operator class (referência por OID) e o
--    `extensions` já está no search_path padrão do banco — o ILIKE segue acelerado.

-- =====================================================================
-- 1) RLS explícito (idempotente; usuario/cupom/item_cupom já tinham, na auth).
-- =====================================================================
alter table public.loja                        enable row level security;
alter table public.produto_canonico            enable row level security;
alter table public.produto_alias               enable row level security;
alter table public.observacao_preco            enable row level security;
alter table public.preco_estatistica           enable row level security;
alter table public.lancamento_manual_moderacao enable row level security;

-- =====================================================================
-- 2) Fecha a SECURITY DEFINER exposta (se existir neste ambiente). O trigger
--    `ensure_rls` foi adicionado fora das migrações; aqui só endurecemos os
--    grants. Em um banco recriado do zero a função pode não existir — guardado.
-- =====================================================================
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;

-- =====================================================================
-- 3) Pin do search_path nas RPCs (não muda a lógica). Forma dinâmica para casar
--    a assinatura exata sem depender dos type modifiers (char(2) etc.).
-- =====================================================================
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
    execute format('alter function %s set search_path = public', r.assinatura);
  end loop;
end
$$;

-- =====================================================================
-- 4) pg_trgm para fora do schema público (se ainda estiver em public). O schema
--    `extensions` já existe em todo projeto Supabase.
-- =====================================================================
do $$
begin
  if exists (
    select 1 from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname = 'public'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
end
$$;
