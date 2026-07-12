-- C9.2.1 — Dedup GLOBAL do pool por chave de acesso (anti-duplicação/anti-abuso).
--
-- A idempotência de cupom é POR USUÁRIO ((usuario_id, chave_acesso) único):
-- duas contas escaneando o MESMO cupom físico publicavam as observações em
-- dobro no pool — distorcendo mediana/percentis e inflando o `n`. Também era o
-- vetor de manipulação mais barato (contas em série "bombando" um cupom).
--
-- A trava certa é na PUBLICAÇÃO, não no escaneamento: todo usuário pode ter a
-- nota no seu histórico PRIVADO; o pool recebe as observações daquela chave
-- UMA única vez. `chave_publicada` guarda só o SHA-256 da chave — nunca a
-- chave crua — sem vínculo com usuário nem com as observações (não dá para
-- religar cesta a pessoa; docs/04). `publicado_em` é DATE (dia, não hora),
-- pela mesma regra de arredondamento da política de privacidade.

create table if not exists public.chave_publicada (
  chave_hash   text not null primary key,
  publicado_em date not null default current_date
);

comment on table public.chave_publicada is
  'C9.2.1 — hashes (SHA-256) das chaves de acesso já publicadas no pool. Dedup global sem vínculo com usuário/observações.';

-- RLS explícito na migração (não depender do event trigger do banco de nuvem):
-- ligado e SEM política = nega tudo para anon/authenticated.
alter table public.chave_publicada enable row level security;

-- Assinatura e retorno mudam: DROP evita conviver com um overload antigo.
drop function if exists processar_cupom(uuid, jsonb, timestamptz, char, jsonb, jsonb, numeric, numeric, boolean);

create or replace function processar_cupom(
  p_cupom_id                uuid,
  p_loja                    jsonb,
  p_emitido_em              timestamptz,
  p_uf                      char(2),
  p_itens                   jsonb,
  p_observacoes             jsonb,
  p_desconto_total          numeric default null,
  p_valor_pago              numeric default null,
  p_sobrescrever_processado boolean default false,
  p_chave_hash              text default null
) returns boolean -- false = havia observações, mas a chave JÁ publicou (dedup)
language plpgsql
set search_path = public
as $$
declare
  v_status   status_cupom;
  v_publicar boolean := true;
  v_linhas   integer;
begin
  -- Trava anti-corrida (C9.3.1): FOR UPDATE serializa dois processadores do
  -- mesmo cupom (fila × ingestão por HTML). O segundo enxerga 'processado' e
  -- vira no-op. `p_sobrescrever_processado` é a exceção do backfill
  -- (job:republicar), que reescreve um processado com guarda própria.
  select status into v_status from cupom where id = p_cupom_id for update;
  if v_status is null or (v_status = 'processado' and not p_sobrescrever_processado) then
    return false;
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

  -- 3) Dedup global do pool (C9.2.1): a chave publica UMA vez, seja qual for a
  --    conta. Só reivindica o hash quando HÁ observações — um cupom que ainda
  --    não casou nada não "queima" a chave (o job:republicar publica depois).
  --    O índice único resolve a corrida de dois scans simultâneos.
  if p_chave_hash is not null
     and jsonb_array_length(coalesce(p_observacoes, '[]'::jsonb)) > 0 then
    insert into chave_publicada (chave_hash) values (p_chave_hash)
    on conflict (chave_hash) do nothing;
    get diagnostics v_linhas = row_count;
    v_publicar := v_linhas > 0;
  end if;

  -- 4) Pool anônimo (append) — só campos de preço; a anonimização já ocorreu.
  if v_publicar then
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
  end if;

  -- 5) Conclui o cupom (privado) — o histórico do usuário existe SEMPRE,
  --    publicando no pool ou não.
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

  return v_publicar;
end;
$$;

comment on function processar_cupom is
  'C9.3.1 + C9.2.1 — Processa o cupom numa transação única (loja + itens privados + pool + status), com trava FOR UPDATE anti-corrida e dedup global do pool por hash da chave. Retorna false quando as observações foram retidas (chave já publicada).';
