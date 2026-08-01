-- C3.6 — Preenche `observado_em_max` nas linhas antigas de `preco_estatistica`.
--
-- A coluna foi criada em 20260729090000, mas as linhas gravadas antes dela
-- ficaram nulas. Este script as preenche retrospectivamente com a data da
-- observação mais recente que sustenta cada célula (produto × escopo × unidade).
--
-- Estratégia: para cada linha de preco_estatistica, agregar novamente O MESMO
-- POOL que a alimentou, mas APENAS para extrair o observado_em da observação
-- mais recente. A correspondência é feita por (produto, unidade_base, escopo).

with observacoes_por_escopo as (
  -- Agrupa observações por escopo geográfico (o mesmo que o pipeline faz).
  -- Loja = CNPJ direto; município/região/UF é derivado da loja de cada observação.
  select
    op.produto_canonico_id,
    op.unidade_base,
    l.cnpj as loja_cnpj,
    l.municipio,
    l.uf,
    op.observado_em
  from observacao_preco op
  inner join loja l on op.loja_cnpj = l.cnpj
),
-- Para cada possível escopo, encontrar a observação mais recente.
max_por_loja as (
  select
    produto_canonico_id,
    unidade_base,
    'loja'::escopo_geo as escopo,
    loja_cnpj as escopo_id,
    max(observado_em) as observado_em_max
  from observacoes_por_escopo
  group by produto_canonico_id, unidade_base, loja_cnpj
),
max_por_municipio as (
  select
    produto_canonico_id,
    unidade_base,
    'municipio'::escopo_geo as escopo,
    municipio as escopo_id,
    max(observado_em) as observado_em_max
  from observacoes_por_escopo
  where municipio is not null
  group by produto_canonico_id, unidade_base, municipio
),
max_por_uf as (
  select
    produto_canonico_id,
    unidade_base,
    'uf'::escopo_geo as escopo,
    uf as escopo_id,
    max(observado_em) as observado_em_max
  from observacoes_por_escopo
  where uf is not null
  group by produto_canonico_id, unidade_base, uf
),
-- Consolidar e fazer o upsert.
todos_escopos as (
  select * from max_por_loja
  union all
  select * from max_por_municipio
  union all
  select * from max_por_uf
)
update preco_estatistica pe
set observado_em_max = te.observado_em_max
from todos_escopos te
where pe.produto_canonico_id = te.produto_canonico_id
  and pe.unidade_base = te.unidade_base
  and pe.escopo = te.escopo
  and pe.escopo_id = te.escopo_id
  and pe.observado_em_max is null
  and pe.n_observacoes > 0;
