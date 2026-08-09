-- C3.4 — Ranking DURÁVEL das unidades de venda que o mapa de normalização não
-- reconhece (`shared/src/estatistica/normalizacao.ts`).
--
-- O contador já existia na escrita: cada item derrubado por unidade desconhecida
-- vira uma linha `unidade_recusada:<CHAVE>` em `telemetria_parsing` (C10.2).
-- Faltava a LEITURA. O `/metricas` servia só o snapshot em MEMÓRIA do processo —
-- e no free tier a instância dorme várias vezes ao dia, então o número que devia
-- guiar "qual abreviação ensinar ao mapa" reiniciava do zero antes de acumular
-- amostra suficiente para decidir. Esta função lê o histórico acumulado.
--
-- Sem dado pessoal (docs/04): a chave da unidade é a abreviação do cupom
-- ("CX", "BDJ"), já normalizada por `chaveUnidade` — nunca descrição de item.

create or replace function public.unidades_recusadas_recentes(
  p_dias  int default 30,
  p_limit int default 100
) returns table (unidade text, total bigint, ufs text[])
language sql
stable
set search_path = public
as $$
  select
    -- `substring(... from N)` corta o prefixo `unidade_recusada:` (17 caracteres).
    substring(t.evento from 18)               as unidade,
    sum(t.contagem)::bigint                   as total,
    array_agg(distinct t.uf order by t.uf)    as ufs
  from telemetria_parsing t
  -- `\_` escapa o underscore: sem isso o `_` do LIKE casa qualquer caractere e
  -- um evento futuro tipo `unidadeXrecusada:` entraria no ranking.
  where t.evento like 'unidade\_recusada:%'
    and t.dia >= current_date - greatest(p_dias, 1)
  group by 1
  order by total desc, unidade
  limit least(greatest(p_limit, 1), 500);
$$;

comment on function public.unidades_recusadas_recentes is
  'C3.4 — abreviações de unidade que caíram fora do pool, por frequência e UF, na janela de dias pedida.';

-- Mesmo fechamento do vetor PostgREST das demais funções de operação (advisor
-- 0028): só a service role executa. O `/metricas` que a expõe já é autenticado
-- por token de curadoria.
revoke execute on function public.unidades_recusadas_recentes(int, int)
  from public, anon, authenticated;
