-- C9.3.2 — Fecha os furos do rate-limit compartilhado (20260801090000).
--
-- A tabela `rate_limit_janela` já dava um contador para toda a frota, mas o
-- caminho do cliente tinha três defeitos que só aparecem sob carga — ou seja,
-- exatamente no cenário que o mecanismo existe para conter:
--
-- 1) NÃO ERA ATÔMICO. O backend fazia SELECT e depois UPDATE em chamadas REST
--    separadas. Com N requisições concorrentes na mesma chave, todas leem a
--    mesma contagem e todas gravam contagem+1: o teto de 120/min passava a
--    deixar passar muito mais. Quanto maior o flood, maior o vazamento.
--    Aqui isso vira UM `insert ... on conflict do update`, que trava a linha e
--    serializa as concorrentes no próprio Postgres.
--
-- 2) A PODA ERA CEGA. O cliente apagava toda linha com `criado_em` mais velho
--    que a SUA janela. Como os limitadores compartilham a tabela, o de leitura
--    pública (janela de 1 min) apagava, a cada minuto, as janelas do limitador
--    de criação de conta (1 h) — que voltavam do zero. O teto de 20 contas/hora
--    virava 20 contas por MINUTO. Agora cada linha guarda o próprio
--    `janela_ms` e a poda só remove o que de fato expirou.
--
-- 3) UMA LINHA POR IP, VALENDO PARA QUATRO TETOS. Ver a mudança de chave em
--    `backend/src/http/servidor.ts`: as chaves passam a levar o escopo. Esta
--    migração não depende disso, mas é a outra metade da correção.
--
-- Depende de: 20260801090000 (tabela) e 20260805100000 (RLS).

-- =====================================================================
-- 1) Tamanho da janela POR LINHA — para a poda saber o que expirou mesmo.
--    Default 0 de propósito: as linhas que já existem passam a ser vistas
--    como expiradas e a primeira poda as recolhe (estado antigo, descartável).
-- =====================================================================
alter table public.rate_limit_janela
  add column if not exists janela_ms bigint not null default 0;

comment on column public.rate_limit_janela.janela_ms is
  'C9.3.2 — Duração da janela desta chave, em ms. Existe para a poda distinguir '
  'a janela de 1 min da de 1 h: sem isto, o limitador mais curto apagava o estado do mais longo.';

-- =====================================================================
-- 2) Consumo ATÔMICO de uma requisição.
--
--    `on conflict do update` pega lock de linha: duas requisições simultâneas
--    na mesma chave entram em fila e cada uma enxerga a contagem da anterior.
--    O `returning` devolve a linha JÁ atualizada, então a decisão sai da mesma
--    ida ao banco que fez a escrita (antes eram duas ou três).
--
--    O relógio vem do CHAMADOR (`p_agora`, epoch ms) e não de `now()`, para os
--    testes poderem avançar o tempo — mesmo contrato do limitador em memória.
--    As instâncias da frota usam `Date.now()`, e um drift de relógio entre elas
--    só desloca a borda da janela, nunca solta o teto.
-- =====================================================================
create or replace function consumir_rate_limit(
  p_chave     text,
  p_agora     bigint,
  p_janela_ms bigint,
  p_maximo    integer
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_contagem integer;
begin
  insert into rate_limit_janela as r (chave, inicio, contagem, janela_ms, criado_em)
  values (p_chave, p_agora, 1, p_janela_ms, now())
  on conflict (chave) do update set
    -- Janela virou? Recomeça do 1. Ainda ativa? Incrementa.
    inicio    = case when p_agora - r.inicio >= p_janela_ms then p_agora else r.inicio end,
    contagem  = case when p_agora - r.inicio >= p_janela_ms then 1 else r.contagem + 1 end,
    criado_em = case when p_agora - r.inicio >= p_janela_ms then now() else r.criado_em end,
    janela_ms = p_janela_ms
  returning r.contagem into v_contagem;

  return v_contagem <= p_maximo;
end;
$$;

comment on function consumir_rate_limit is
  'C9.3.2 — Registra uma requisição da chave e devolve se ela cabe no teto. '
  'Atômico: o on conflict serializa as concorrentes, então o contador não vaza sob flood.';

-- =====================================================================
-- 3) Poda das janelas encerradas.
--
--    Roda no máximo uma vez por janela (o cliente controla), porque varrer a
--    tabela a cada requisição custaria mais que o próprio check. Só apaga o que
--    passou da PRÓPRIA janela — ver o defeito (2) no cabeçalho.
-- =====================================================================
create or replace function podar_rate_limit(p_agora bigint)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_apagadas integer;
begin
  delete from rate_limit_janela
  where p_agora - inicio >= janela_ms;

  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$$;

comment on function podar_rate_limit is
  'C9.3.2 — Remove as janelas já encerradas (cada linha pelo próprio janela_ms). '
  'Chamada no máximo uma vez por janela pelo backend.';

-- =====================================================================
-- 4) Privilégio. `20260724090000` já revogou routines de anon/authenticated e
--    ajustou os default privileges, mas estas duas funções SÃO o mecanismo de
--    proteção: se a anon key (que vive dentro do APK) pudesse chamá-las,
--    dava para queimar o orçamento de outro IP/conta à vontade. Explícito aqui
--    para não depender de a migração anterior ter pegado o papel criador.
--
--    `from public` NÃO é decoração: toda função em Postgres nasce com EXECUTE
--    concedido a PUBLIC, e `anon`/`authenticated` herdam de PUBLIC. Revogar só
--    dos dois papéis nomeados deixa a concessão de PUBLIC intacta, e
--    `has_function_privilege('anon', ..., 'execute')` continua devolvendo true —
--    as RPCs seguiriam alcançáveis pela anon key. Mesma forma das irmãs
--    (`processar_cupom`, `incrementar_telemetria_parsing`, 20260722110000).
-- =====================================================================
revoke execute on function consumir_rate_limit(text, bigint, bigint, integer)
  from public, anon, authenticated;
revoke execute on function podar_rate_limit(bigint)
  from public, anon, authenticated;
