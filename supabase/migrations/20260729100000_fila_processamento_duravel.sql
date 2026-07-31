-- C2.1 — Fila de processamento DURÁVEL no Postgres.
--
-- A fila vivia só na memória do processo (`fila/fila-memoria.ts`). Isso estava
-- correto enquanto o backend fosse UMA instância, e o buraco do restart era
-- tapado pela recuperação de boot (`reprocessador.recuperarPendentes`). Duas
-- instâncias quebram as duas coisas de uma vez:
--
--  • cada processo tem a SUA lista, então as duas pegam os mesmos cupons
--    (dois parses, duas idas ao portal da SEFAZ pelo mesmo cupom);
--  • a recuperação de boot de uma instância re-enfileira o que a OUTRA está
--    processando naquele instante.
--
-- A fila passa a ser uma tabela, e a exclusão mútua vira o `for update skip
-- locked` de `fila_reivindicar`: cada linha é entregue a UM e só um consumidor.
-- O resto do desenho segue o que já existia — retry/backoff, teto de tentativas,
-- e "esgotou" deixa o cupom para o reprocessamento retroativo (C2.5).
--
-- CONCESSÃO (lease, não lock eterno): quem reivindica marca `reivindicado_em` e
-- tem `p_lease_seg` para concluir. Estourou o prazo, a linha volta a ser
-- reivindicável — é isso que recupera o trabalho de uma instância que morreu no
-- meio (deploy, OOM, hibernação do free tier) sem precisar de ninguém no boot.
-- O preço é a possibilidade de processar duas vezes um cupom cuja lease expirou
-- com o worker ainda vivo; o caminho de escrita já é idempotente contra isso
-- (`ProcessadorCupom` sai na hora se o cupom já está `processado`, e o pool
-- deduplica por chave publicada — 20260712090000).
--
-- LGPD: fila de TRABALHO do lado privado. Só o id do cupom, a UF e o estado do
-- retry — nada de chave de acesso, CPF ou conteúdo do QR. `ultimo_erro` recebe
-- texto JÁ sanitizado pelo backend (mesma regra do `cupom.motivo_falha`).

-- =====================================================================
-- 1) A fila.
-- =====================================================================
create table if not exists public.fila_processamento (
  -- Uma linha por cupom: a PK é o que faz `enfileirar` ser idempotente (o retry
  -- do cliente e a recuperação de boot não criam trabalho duplicado).
  cupom_id         uuid primary key references public.cupom (id) on delete cascade,
  -- Só para telemetria por estado (C10.2) — a UF canônica é a da chave.
  uf               char(2),
  tentativas       int         not null default 0,
  -- Quando a linha volta a ser reivindicável. É aqui que mora o backoff.
  disponivel_em    timestamptz not null default now(),
  -- Lease em vigor: quem pegou e quando (ver a nota do cabeçalho).
  reivindicado_em  timestamptz,
  reivindicado_por text,
  -- Tentativas esgotadas: sai da fila de trabalho e fica como evidência.
  esgotado_em      timestamptz,
  ultimo_erro      text,
  criado_em        timestamptz not null default now()
);

comment on table public.fila_processamento is
  'Fila durável de parsing de cupom (C2.1). Reivindicação por for update skip '
  'locked = uma linha, um consumidor, mesmo com várias instâncias. Sem dado '
  'pessoal: id do cupom, UF e estado do retry.';

comment on column public.fila_processamento.disponivel_em is
  'Instante a partir do qual a tarefa pode ser reivindicada — o backoff do retry.';

comment on column public.fila_processamento.reivindicado_em is
  'Início da lease. Expirada (> p_lease_seg), a tarefa volta à fila: é o que '
  'recupera o trabalho de uma instância que morreu no meio.';

comment on column public.fila_processamento.ultimo_erro is
  'Mensagem JÁ sanitizada (sanitizarErro) do último erro transitório. Nunca '
  'conteúdo de QR/nota — docs/04.';

-- Índice da reivindicação: só as linhas vivas, na ordem em que são drenadas.
create index if not exists fila_processamento_pronta_idx
  on public.fila_processamento (disponivel_em)
  where esgotado_em is null;

-- RLS explícito na migração (não depender do event trigger do banco de nuvem):
-- ligado e SEM política = nega tudo para anon/authenticated. Só a service role
-- (o backend) enxerga a fila.
alter table public.fila_processamento enable row level security;

-- =====================================================================
-- 2) Enfileirar (idempotente por cupom).
--
--    O `where` do DO UPDATE é a trava importante: uma tarefa com lease VIVA não
--    é rearmada. Sem ele, a recuperação de boot de uma instância zeraria as
--    tentativas e liberaria o cupom que a outra instância está processando
--    naquele segundo — exatamente o bug que esta migração existe para fechar.
-- =====================================================================
create or replace function public.fila_enfileirar(
  p_cupom_id  uuid,
  p_uf        text default null,
  p_lease_seg int default 300
) returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.fila_processamento as f (cupom_id, uf)
  values (p_cupom_id, nullif(trim(coalesce(p_uf, '')), '')::char(2))
  on conflict (cupom_id) do update set
    uf               = coalesce(excluded.uf, f.uf),
    tentativas       = 0,
    disponivel_em    = now(),
    esgotado_em      = null,
    ultimo_erro      = null,
    reivindicado_em  = null,
    reivindicado_por = null
  where f.reivindicado_em is null
     or f.reivindicado_em < now() - make_interval(secs => greatest(p_lease_seg, 1));
$$;

comment on function public.fila_enfileirar is
  'Enfileira (ou rearma) o parsing de um cupom. Não mexe em tarefa com lease viva.';

-- =====================================================================
-- 3) Reivindicar um lote — o coração da exclusão mútua entre instâncias.
--
--    `skip locked` faz cada consumidor pular o que outro acabou de travar, em
--    vez de esperar na fila do lock: N instâncias drenam em paralelo sem nunca
--    pegar a mesma linha. A tentativa é contada AQUI, no ato de pegar: worker
--    que trava e perde a lease consome uma tentativa, então cupom-veneno esgota
--    em vez de circular para sempre.
-- =====================================================================
create or replace function public.fila_reivindicar(
  p_limite    int,
  p_lease_seg int  default 300,
  p_worker    text default null
) returns table (cupom_id uuid, uf text, tentativas int)
language sql
security invoker
set search_path = public
as $$
  with prontas as (
    select fp.cupom_id as id
    from public.fila_processamento fp
    where fp.esgotado_em is null
      and fp.disponivel_em <= now()
      and (
        fp.reivindicado_em is null
        or fp.reivindicado_em < now() - make_interval(secs => greatest(p_lease_seg, 1))
      )
    order by fp.disponivel_em
    limit greatest(coalesce(p_limite, 0), 0)
    for update skip locked
  )
  update public.fila_processamento f
  set reivindicado_em  = now(),
      reivindicado_por = left(coalesce(p_worker, 'desconhecido'), 64),
      tentativas       = f.tentativas + 1
  where f.cupom_id in (select prontas.id from prontas)
  returning f.cupom_id, f.uf::text, f.tentativas;
$$;

comment on function public.fila_reivindicar is
  'Entrega até p_limite tarefas a UM consumidor (for update skip locked), '
  'contando a tentativa e abrindo a lease de p_lease_seg.';

-- =====================================================================
-- 4) Concluir — sucesso sai da fila. O cupom `processado` é o registro.
-- =====================================================================
create or replace function public.fila_concluir(p_cupom_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.fila_processamento where cupom_id = p_cupom_id;
$$;

comment on function public.fila_concluir is
  'Remove a tarefa concluída. O estado do cupom (processado/falha) é o registro.';

-- =====================================================================
-- 5) Falhar — devolve à fila com backoff, ou esgota.
--
--    Retorna `true` quando ESGOTOU (o backend avisa a telemetria e loga
--    `fila.esgotada`). A linha esgotada fica: é o rastro de por que aquele
--    cupom do usuário parou, e o retroativo (C2.5) a rearma quando o parser
--    daquele estado melhorar.
-- =====================================================================
create or replace function public.fila_falhar(
  p_cupom_id       uuid,
  p_espera_ms      int,
  p_tentativas_max int,
  p_erro           text default null
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_esgotada boolean;
begin
  update public.fila_processamento f
  set disponivel_em    = now() + make_interval(
                           secs => (greatest(coalesce(p_espera_ms, 0), 0) / 1000.0)::double precision
                         ),
      reivindicado_em  = null,
      reivindicado_por = null,
      ultimo_erro      = left(p_erro, 500),
      esgotado_em      = case
                           when f.tentativas >= greatest(coalesce(p_tentativas_max, 1), 1) then now()
                           else null
                         end
  where f.cupom_id = p_cupom_id
  returning f.esgotado_em is not null into v_esgotada;

  -- Sem linha (concluída/apagada em paralelo) não é erro: nada a retentar.
  return coalesce(v_esgotada, false);
end;
$$;

comment on function public.fila_falhar is
  'Devolve a tarefa à fila com backoff; marca esgotado_em no teto de tentativas. '
  'Retorna true quando esgotou.';

-- =====================================================================
-- 6) Estado — profundidade da fila para a sonda de saúde (C10.4).
--
--    Lease EXPIRADA conta como pendente, não como "em curso": ninguém está
--    trabalhando nela. Contar a linha órfã como em curso é o tipo de número que
--    faz uma fila represada parecer ocupada.
-- =====================================================================
create or replace function public.fila_estado(p_lease_seg int default 300)
returns table (pendentes int, em_curso int, esgotadas int)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (
      where f.esgotado_em is null
        and (
          f.reivindicado_em is null
          or f.reivindicado_em < now() - make_interval(secs => greatest(p_lease_seg, 1))
        )
    )::int,
    count(*) filter (
      where f.esgotado_em is null
        and f.reivindicado_em >= now() - make_interval(secs => greatest(p_lease_seg, 1))
    )::int,
    count(*) filter (where f.esgotado_em is not null)::int
  from public.fila_processamento f;
$$;

comment on function public.fila_estado is
  'Profundidade da fila (pendentes/em curso/esgotadas) — fonte da sonda de /saude.';

-- =====================================================================
-- 7) Fechar o EXECUTE público (advisors 0028/0029, mesma regra das outras
--    RPCs de domínio — ver 20260722110000). Só a service role chama a fila.
-- =====================================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'fila_enfileirar', 'fila_reivindicar', 'fila_concluir',
        'fila_falhar', 'fila_estado'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.assinatura);
  end loop;
end
$$;

-- =====================================================================
-- 8) Semente: o que já está represado entra na fila uma vez.
--    Cupons `qr_capturado` são exatamente o que a recuperação de boot pegava.
--    Sem isto, a primeira subida com a fila durável começaria vazia e o que já
--    estava preso continuaria preso.
-- =====================================================================
insert into public.fila_processamento (cupom_id, uf)
select c.id, c.uf from public.cupom c where c.status = 'qr_capturado'
on conflict (cupom_id) do nothing;
