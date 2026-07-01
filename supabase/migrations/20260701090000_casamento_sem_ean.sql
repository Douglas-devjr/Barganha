-- Casamento por DESCRIÇÃO para itens sem EAN.
-- Vários portais (ex.: RJ/ENCAT) mostram só o código INTERNO da loja no item —
-- sem EAN, nada do cupom entrava no pool e a estatística nunca nascia. O
-- casamento passa a acha-ou-criar o canônico pela descrição normalizada exata
-- (+ unidade-base). Este índice é a trava de identidade (e cobre a corrida do
-- acha-ou-cria no repositório, que reconsulta no conflito).
create unique index if not exists produto_canonico_sem_ean_descricao_uidx
  on public.produto_canonico (descricao_normalizada, unidade_base)
  where ean is null;

-- `processar_cupom`: o upsert da loja passa a PRESERVAR campos ricos quando a
-- nova escrita vem sem eles (null/vazio). Motivo: a republicação do pool
-- (job `republicar-pool`, backfill de cupons processados antes do casamento
-- sem EAN) reconstrói a nota a partir do lado privado, que não guarda o
-- endereço da loja — sem o coalesce, o upsert apagaria o endereço já salvo.
-- O caminho normal (parse completo) sempre traz os campos, então nada muda lá.
create or replace function processar_cupom(
  p_cupom_id    uuid,
  p_loja        jsonb,
  p_emitido_em  timestamptz,
  p_uf          char(2),
  p_itens       jsonb,
  p_observacoes jsonb
) returns void
language plpgsql
set search_path = public -- preserva o pin da 20260629130000 (o replace o resetaria)
as $$
begin
  -- 1) Loja (compartilhado) — upsert pela PK cnpj, sem regredir dado existente.
  insert into loja (cnpj, razao_social, nome_fantasia, endereco, municipio, uf, atualizado_em)
  values (
    p_loja->>'cnpj',
    nullif(p_loja->>'razao_social', ''),
    nullif(p_loja->>'nome_fantasia', ''),
    nullif(p_loja->>'endereco', ''),
    nullif(p_loja->>'municipio', ''),
    nullif(p_loja->>'uf', ''),
    now()
  )
  on conflict (cnpj) do update set
    razao_social  = coalesce(excluded.razao_social, loja.razao_social),
    nome_fantasia = coalesce(excluded.nome_fantasia, loja.nome_fantasia),
    endereco      = coalesce(excluded.endereco, loja.endereco),
    municipio     = coalesce(excluded.municipio, loja.municipio),
    uf            = coalesce(excluded.uf, loja.uf),
    atualizado_em = now();

  -- 2) Itens privados — substitui os anteriores (idempotência do reprocessamento).
  delete from item_cupom where cupom_id = p_cupom_id;

  insert into item_cupom (
    cupom_id, produto_canonico_id, descricao_original, ean,
    quantidade, unidade, valor_unitario, valor_total, desconto
  )
  select
    p_cupom_id,
    nullif(i->>'produto_canonico_id', '')::uuid,
    i->>'descricao_original',
    nullif(i->>'ean', ''),
    (i->>'quantidade')::numeric,
    i->>'unidade',
    (i->>'valor_unitario')::numeric,
    (i->>'valor_total')::numeric,
    nullif(i->>'desconto', '')::numeric
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) as i;

  -- 3) Pool anônimo (append) — só campos de preço; a anonimização já ocorreu.
  insert into observacao_preco (
    produto_canonico_id, loja_cnpj, municipio, uf,
    preco_normalizado, unidade_base, em_promocao, observado_em
  )
  select
    (o->>'produto_canonico_id')::uuid,
    o->>'loja_cnpj',
    nullif(o->>'municipio', ''),
    nullif(o->>'uf', ''),
    (o->>'preco_normalizado')::numeric,
    o->>'unidade_base',
    coalesce((o->>'em_promocao')::boolean, false),
    (o->>'observado_em')::timestamptz
  from jsonb_array_elements(coalesce(p_observacoes, '[]'::jsonb)) as o;

  -- 4) Conclui o cupom (privado).
  update cupom set
    loja_cnpj     = p_loja->>'cnpj',
    emitido_em    = p_emitido_em,
    uf            = p_uf,
    status        = 'processado',
    atualizado_em = now()
  where id = p_cupom_id;
end;
$$;

comment on function processar_cupom is
  'C9.3.1 — Conclui o processamento de um cupom numa transação única (loja + itens privados + pool anônimo + status). Evita duplicar observações no retry; upsert da loja não regride campos ricos.';
