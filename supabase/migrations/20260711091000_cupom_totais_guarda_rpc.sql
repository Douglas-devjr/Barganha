-- F2 — Totais do cupom persistidos + motivo de falha + guarda anti-corrida na RPC.
--
-- 1) `desconto_total`/`valor_pago` no CUPOM (lado privado): antes, os totais só
--    chegavam ao app pela resposta da ingestão por HTML (C2.6); no caminho
--    servidor (fila + polling) o desconto era extraído do portal e DESCARTADO.
-- 2) `falha_motivo`: a falha permanente de parsing só existia no console do
--    servidor — sem persistir o motivo era impossível diagnosticar por que um
--    cupom não leu (C10.2).
-- 3) `processar_cupom` ganha trava de status com FOR UPDATE: fila e ingestão
--    por HTML podem processar o MESMO cupom em corrida; sem a trava, os dois
--    commits duplicavam as observações no pool (append-only, indedupável a
--    posteriori — C9.3.1).
--
-- LGPD: nada aqui toca o pool compartilhado; totais e motivo são do cupom
-- PRIVADO do dono (docs/04). Tabela já coberta pelo RLS existente.

alter table cupom add column if not exists desconto_total numeric;
alter table cupom add column if not exists valor_pago     numeric;
alter table cupom add column if not exists falha_motivo   text;

comment on column cupom.desconto_total is 'Desconto total do cupom (R$) informado pelo portal — privado do dono.';
comment on column cupom.valor_pago     is 'Valor efetivamente pago (R$) = bruto − desconto — privado do dono.';
comment on column cupom.falha_motivo   is 'Motivo da última falha permanente de parsing (diagnóstico, C10.2).';

-- Assinatura muda (2 parâmetros novos): sem o drop, o CREATE criaria um
-- OVERLOAD e as duas versões conviveriam no schema.
drop function if exists processar_cupom(uuid, jsonb, timestamptz, char, jsonb, jsonb);

create or replace function processar_cupom(
  p_cupom_id                uuid,
  p_loja                    jsonb,
  p_emitido_em              timestamptz,
  p_uf                      char(2),
  p_itens                   jsonb,
  p_observacoes             jsonb,
  p_desconto_total          numeric default null,
  p_valor_pago              numeric default null,
  p_sobrescrever_processado boolean default false
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_status status_cupom;
begin
  -- Trava anti-corrida (C9.3.1): FOR UPDATE serializa dois processadores do
  -- mesmo cupom (fila × ingestão por HTML). O segundo enxerga 'processado' e
  -- vira no-op — sem ela, ambos inseririam no pool e a observação duplicaria.
  -- `p_sobrescrever_processado` é a exceção DELIBERADA do backfill
  -- (job:republicar), que reescreve um processado com guarda própria.
  select status into v_status from cupom where id = p_cupom_id for update;
  if v_status is null or (v_status = 'processado' and not p_sobrescrever_processado) then
    return;
  end if;

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

  -- 4) Conclui o cupom (privado) — totais persistidos p/ o app (F2); limpa o
  --    motivo de falha de tentativas anteriores.
  update cupom set
    loja_cnpj      = p_loja->>'cnpj',
    emitido_em     = p_emitido_em,
    uf             = p_uf,
    desconto_total = p_desconto_total,
    valor_pago     = p_valor_pago,
    falha_motivo   = null,
    status         = 'processado',
    atualizado_em  = now()
  where id = p_cupom_id;
end;
$$;

comment on function processar_cupom is
  'C9.3.1 — Conclui o processamento de um cupom numa transação única (loja + itens privados + pool anônimo + totais + status), com trava FOR UPDATE contra processamento duplo em corrida.';
