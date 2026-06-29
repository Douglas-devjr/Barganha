-- C9.3.1 — Ingestão transacional (RPC atômica).
-- Antes, `marcarProcessado` (repositorio-supabase.ts) fazia 4 escritas
-- SEQUENCIAIS (loja, item_cupom, observacao_preco, cupom). Uma falha parcial
-- DEPOIS de inserir no pool deixava o cupom não-`processado`; o retry da fila
-- reprocessava e DUPLICAVA as observações no pool (o pool é append-only, sem
-- vínculo com o cupom, então não há como deduplicar a posteriori).
--
-- Esta função roda as 4 escritas no MESMO statement → uma única transação
-- implícita (plpgsql): ou tudo entra, ou nada entra. O retro-reprocessamento
-- (C2.5) só alveja cupons não-`processado`, então não há dupla contagem.
--
-- A separação privado/compartilhado é preservada: as observações chegam já
-- anonimizadas (passaram pelo gate em shared/ + `garantirSemDadoPessoal` no
-- backend); aqui só há campos de preço — sem usuario_id/cupom_id/chave.

create or replace function processar_cupom(
  p_cupom_id    uuid,
  p_loja        jsonb,
  p_emitido_em  timestamptz,
  p_uf          char(2),
  p_itens       jsonb,
  p_observacoes jsonb
) returns void
language plpgsql
as $$
begin
  -- 1) Loja (compartilhado) — upsert pela PK cnpj.
  insert into loja (cnpj, razao_social, nome_fantasia, endereco, municipio, uf, atualizado_em)
  values (
    p_loja->>'cnpj',
    p_loja->>'razao_social',
    p_loja->>'nome_fantasia',
    p_loja->>'endereco',
    p_loja->>'municipio',
    nullif(p_loja->>'uf', ''),
    now()
  )
  on conflict (cnpj) do update set
    razao_social  = excluded.razao_social,
    nome_fantasia = excluded.nome_fantasia,
    endereco      = excluded.endereco,
    municipio     = excluded.municipio,
    uf            = excluded.uf,
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
  'C9.3.1 — Conclui o processamento de um cupom numa transação única (loja + itens privados + pool anônimo + status). Evita duplicar observações no retry.';
