-- Fecha o acesso direto ao banco pela anon key — na camada de PRIVILÉGIO.
--
-- CONTEXTO. A anon key vive dentro do APK e pode ser extraída em minutos. Com
-- ela dá para falar com o PostgREST (`/rest/v1/...`) do projeto. Até aqui, a
-- ÚNICA coisa que impedia alguém de baixar o pool inteiro era o RLS: os papéis
-- `anon` e `authenticated` tinham GRANT em todas as 13 tabelas de `public`.
--
-- Uma política mal escrita, ou uma tabela nova que escape do RLS, e o banco
-- abre. Defesa em profundidade quer duas camadas independentes; tínhamos uma.
--
-- POR QUE NÃO A SOLUÇÃO ÓBVIA. O caminho "remover public das Exposed schemas"
-- do dashboard NÃO serve aqui: o BACKEND fala com o banco pelo próprio
-- PostgREST (supabase-js com a service role — ver persistencia/supabase.ts).
-- Desexpor `public` derrubaria ingestão, consulta e sync junto com o atacante.
--
-- O QUE ISTO FAZ. Revoga os privilégios de `anon`/`authenticated` em public e
-- ajusta os DEFAULT PRIVILEGES para tabela nova nascer sem grant. O
-- `service_role` (usado só pelo backend, no servidor) fica intacto — é ele que
-- serve o app. O RLS continua no lugar como segunda camada.
--
-- SEGURO PORQUE o app NÃO usa PostgREST: o cliente Supabase do aparelho só fala
-- com o GoTrue (`/auth/v1`), que vive no schema `auth` e não é afetado. Login,
-- cadastro, refresh de token e OAuth seguem funcionando.
--
-- REVERSÍVEL: `grant all on all tables in schema public to anon, authenticated;`

-- =====================================================================
-- 1) Privilégios já concedidos.
-- =====================================================================
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines  in schema public from anon, authenticated;

-- =====================================================================
-- 2) Objetos FUTUROS. Sem isto, a próxima migração que criar uma tabela a
--    entrega de novo para anon/authenticated pelos default privileges do
--    Supabase — e o furo volta em silêncio.
--
--    Default privileges são por papel CRIADOR. Cobrimos os que criam objeto
--    aqui (`postgres` nas migrações, `supabase_admin` no que a plataforma
--    provisiona); o bloco é guardado porque nem todo ambiente concede
--    privilégio para alterar defaults de outro papel.
-- =====================================================================
do $$
declare
  criador text;
begin
  foreach criador in array array['postgres', 'supabase_admin'] loop
    begin
      execute format(
        'alter default privileges for role %I in schema public revoke all on tables from anon, authenticated',
        criador);
      execute format(
        'alter default privileges for role %I in schema public revoke all on sequences from anon, authenticated',
        criador);
      execute format(
        'alter default privileges for role %I in schema public revoke all on functions from anon, authenticated',
        criador);
    exception
      when insufficient_privilege or undefined_object then
        raise notice 'Sem privilégio para ajustar default privileges de %, seguindo.', criador;
    end;
  end loop;
end
$$;
