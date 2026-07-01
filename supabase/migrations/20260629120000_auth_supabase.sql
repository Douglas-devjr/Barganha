-- C4.3.1 — Login real (Supabase Auth) sobre o lado PRIVADO.
-- Decisão de produto: login OBRIGATÓRIO (email/senha ou Google), substituindo a
-- conta anônima de C4.3. Resolve docs/01 ("evoluir para JWT/Supabase Auth") e o
-- item "conta anônima como opção" de CLAUDE.md.
--
-- LGPD (docs/04): o dado de autenticação (email, identidade Google, senha
-- criptografada) vive SÓ em `auth.users` — esquema gerido do Supabase. É o
-- mínimo para autenticar, com base legal de execução de contrato/segurança da
-- conta. NUNCA cruza para o pool compartilhado: `observacao_preco` continua
-- anônima e solta (sem usuario_id, sem chave_acesso). Esta migração toca apenas
-- as tabelas PRIVADAS (usuario/cupom/item_cupom).

-- =====================================================================
-- 1) usuario.id passa a ser o id da conta de auth (auth.users.id).
-- =====================================================================

-- Contas órfãs pré-auth (dev): contas anônimas antigas não têm credencial real
-- e não existiriam sob login obrigatório. Seguro: o seed é vazio e o projeto
-- está no início do desenvolvimento. Cascateia para cupom/item_cupom.
delete from public.usuario u
where not exists (select 1 from auth.users a where a.id = u.id);

-- O id agora vem do Supabase Auth (não mais gerado aqui) e referencia auth.users.
-- on delete cascade: apagar a conta de auth remove todo o histórico privado
-- (direito ao apagamento, docs/04) — sem deixar cupom/item órfão. Guardado por
-- idempotência (re-aplicar a migração não deve falhar com "constraint já existe").
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'usuario_id_fkey' and conrelid = 'public.usuario'::regclass
  ) then
    alter table public.usuario
      alter column id drop default,
      add constraint usuario_id_fkey
        foreign key (id) references auth.users (id) on delete cascade;
  end if;
end
$$;

comment on table public.usuario is
  'Conta (PRIVADO). id = auth.users.id (Supabase Auth). Sem nome/CPF aqui — o '
  'dado de login mora em auth.users. Nunca cruza para o pool (LGPD, docs/04).';

-- =====================================================================
-- 2) Provisão automática da linha em public.usuario a cada novo cadastro.
--    O trigger roda no insert de auth.users (signup email/senha ou Google).
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuario (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user is
  'C4.3.1 — Cria a linha PRIVADA em public.usuario quando uma conta de auth nasce.';

-- O trigger dispara a função internamente — ela não precisa ser chamável direto.
-- Revogar o EXECUTE público fecha o vetor de uma SECURITY DEFINER exposta como
-- RPC pelo PostgREST (advisors 0028/0029).
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 3) RLS no lado PRIVADO — defesa em profundidade.
--    O backend usa a SERVICE ROLE (ignora RLS), então a ingestão segue
--    funcionando. As políticas protegem qualquer acesso DIRETO do app
--    (chave anônima + sessão do usuário): cada um só enxerga o que é seu.
--    O pool compartilhado NÃO ganha RLS aqui (não tem PII; é servido pelo
--    backend). Abrir leitura direta do pool fica como follow-up, se preciso.
-- =====================================================================

alter table public.usuario enable row level security;
alter table public.cupom enable row level security;
alter table public.item_cupom enable row level security;

-- usuario: o dono lê/edita/apaga só a própria linha. (Inserção é via trigger,
-- security definer, que ignora RLS.) `drop ... if exists` torna idempotente.
drop policy if exists usuario_proprio_select on public.usuario;
create policy usuario_proprio_select on public.usuario
  for select using (auth.uid() = id);
drop policy if exists usuario_proprio_update on public.usuario;
create policy usuario_proprio_update on public.usuario
  for update using (auth.uid() = id);
drop policy if exists usuario_proprio_delete on public.usuario;
create policy usuario_proprio_delete on public.usuario
  for delete using (auth.uid() = id);

-- cupom: só os cupons do próprio usuário.
drop policy if exists cupom_proprio_all on public.cupom;
create policy cupom_proprio_all on public.cupom
  for all
  using (auth.uid() = usuario_id)
  with check (auth.uid() = usuario_id);

-- item_cupom: itens cujo cupom pertence ao usuário.
drop policy if exists item_cupom_proprio_all on public.item_cupom;
create policy item_cupom_proprio_all on public.item_cupom
  for all
  using (
    exists (
      select 1 from public.cupom c
      where c.id = item_cupom.cupom_id and c.usuario_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.cupom c
      where c.id = item_cupom.cupom_id and c.usuario_id = auth.uid()
    )
  );
