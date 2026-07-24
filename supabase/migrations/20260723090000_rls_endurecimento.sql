-- Endurecimento do RLS — duas correções independentes.
--
-- 1) PERFORMANCE: `auth.uid()` chamado direto numa política é reavaliado UMA VEZ
--    POR LINHA examinada. Envolvido em subselect — `(select auth.uid())` — o
--    planejador o promove a InitPlan: avalia uma vez por query e reusa. É a
--    recomendação oficial do Supabase (advisor `auth_rls_initplan`). Em 10 linhas
--    ninguém nota; em 100 mil é a diferença entre milissegundos e segundos.
--    NÃO muda quem enxerga o quê — só quando a função é chamada.
--
-- 2) DRIFT: o event trigger `ensure_rls`/`rls_auto_enable` (que liga RLS em
--    tabela nova automaticamente) foi criado à mão no banco de nuvem e nunca
--    entrou nas migrações. Resultado: `supabase db reset` recriava o banco SEM a
--    rede de segurança, e qualquer tabela nova nascia ABERTA à anon key. Aqui ele
--    passa a ser versionado.
--
--    Atenção: criar event trigger exige privilégio elevado, que nem todo ambiente
--    concede ao papel das migrações. Por isso a criação é GUARDADA — se não
--    puder, avisa e segue. A garantia que não depende de privilégio é o teste
--    estático `rls-migracoes.test.ts`, que quebra o CI se uma migração criar
--    tabela em `public` sem ligar RLS.

-- =====================================================================
-- 1) Políticas do lado PRIVADO com auth.uid() em InitPlan.
-- =====================================================================

drop policy if exists usuario_proprio_select on public.usuario;
create policy usuario_proprio_select on public.usuario
  for select using ((select auth.uid()) = id);

drop policy if exists usuario_proprio_update on public.usuario;
create policy usuario_proprio_update on public.usuario
  for update using ((select auth.uid()) = id);

drop policy if exists usuario_proprio_delete on public.usuario;
create policy usuario_proprio_delete on public.usuario
  for delete using ((select auth.uid()) = id);

drop policy if exists cupom_proprio_all on public.cupom;
create policy cupom_proprio_all on public.cupom
  for all
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

drop policy if exists item_cupom_proprio_all on public.item_cupom;
create policy item_cupom_proprio_all on public.item_cupom
  for all
  using (
    exists (
      select 1 from public.cupom c
      where c.id = item_cupom.cupom_id and c.usuario_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.cupom c
      where c.id = item_cupom.cupom_id and c.usuario_id = (select auth.uid())
    )
  );

-- =====================================================================
-- 2) Rede de segurança versionada: RLS automático em tabela nova.
-- =====================================================================

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  obj record;
begin
  for obj in
    select object_identity
    from pg_event_trigger_ddl_commands()
    where command_tag = 'CREATE TABLE' and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', obj.object_identity);
    raise notice 'RLS ligado automaticamente em %', obj.object_identity;
  end loop;
end;
$$;

comment on function public.rls_auto_enable is
  'Liga RLS em toda tabela nova de public. Rede de segurança: a garantia primária '
  'é RLS explícito na migração + o teste estático rls-migracoes.test.ts.';

-- SECURITY DEFINER não pode ficar chamável por anon/authenticated (advisors
-- 0028/0029). O trigger a invoca internamente; ninguém precisa chamá-la.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

do $$
begin
  drop event trigger if exists ensure_rls;
  create event trigger ensure_rls
    on ddl_command_end
    when tag in ('CREATE TABLE')
    execute function public.rls_auto_enable();
exception
  when insufficient_privilege then
    raise notice
      'Sem privilégio para criar o event trigger ensure_rls neste ambiente. '
      'A proteção segue valendo pelo RLS explícito nas migrações + teste de CI.';
end
$$;
