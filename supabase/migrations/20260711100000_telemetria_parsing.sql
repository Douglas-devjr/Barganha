-- C10.2 — Telemetria de parsing PERSISTENTE (dia × UF × evento).
--
-- O coletor em memória (`TelemetriaMemoria`) zera a cada restart do processo.
-- No free tier (instância que DORME após inatividade) isso apaga o histórico
-- várias vezes ao dia — a operação ficaria cega para a taxa de `erro_portal`
-- vs `processado` que decide o lançamento do RJ. Esta tabela acumula os
-- contadores por dia; o backend persiste cada evento em best-effort
-- (fire-and-forget) e o `/metricas` continua servindo o snapshot do processo.
--
-- Sem dado pessoal (docs/04): só contadores agregados de desfecho por UF.

create table if not exists public.telemetria_parsing (
  dia           date        not null,
  uf            text        not null,
  evento        text        not null,
  contagem      bigint      not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (dia, uf, evento)
);

comment on table public.telemetria_parsing is
  'C10.2 — contadores diários de desfechos do parsing por UF (sem dado pessoal).';

-- RLS explícito na migração (não depender do event trigger `ensure_rls`, que só
-- existe no banco de nuvem): ligado e SEM política = nega tudo para
-- anon/authenticated; só o backend (service role) lê/escreve.
alter table public.telemetria_parsing enable row level security;

-- Incremento atômico do contador do dia corrente (UTC). `security invoker`
-- (padrão): roda como a service role do backend.
create or replace function public.incrementar_telemetria_parsing(
  p_uf     text,
  p_evento text
) returns void
language sql
set search_path = public
as $$
  insert into telemetria_parsing (dia, uf, evento, contagem, atualizado_em)
  values (current_date, p_uf, p_evento, 1, now())
  on conflict (dia, uf, evento) do update set
    contagem      = telemetria_parsing.contagem + 1,
    atualizado_em = now();
$$;

comment on function public.incrementar_telemetria_parsing is
  'C10.2 — incrementa o contador diário (dia corrente, UTC) de um desfecho de parsing por UF.';

-- Fecha o vetor PostgREST (advisor 0028): só a service role executa.
revoke execute on function public.incrementar_telemetria_parsing(text, text)
  from public, anon, authenticated;
