-- Fecha o vetor da SECURITY DEFINER handle_new_user exposta via PostgREST RPC
-- (advisors 0028/0029). O trigger on_auth_user_created continua disparando-a
-- internamente — EXECUTE público não é necessário.
--
-- PROCEDÊNCIA: esta migração existia SÓ no banco de nuvem (aplicada pelo painel
-- ou pelo MCP, sem arquivo no repositório). Foi recuperada de
-- `supabase_migrations.schema_migrations` durante a reconciliação do histórico
-- em 22/07/2026 e materializada aqui — sem ela, um `supabase db reset` recriaria
-- o banco com o EXECUTE público reaberto, reintroduzindo o advisor.
--
-- O timestamp foi mantido idêntico ao registro remoto de propósito: assim a
-- migração continua "aplicada" na nuvem e o arquivo apenas passa a documentá-la.
--
-- Depende de: auth_supabase (cria `public.handle_new_user`).

revoke execute on function public.handle_new_user() from public, anon, authenticated;
