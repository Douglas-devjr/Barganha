-- Preserva o código INTERNO da loja (SKU) quando o campo de código da NFC-e
-- NÃO é um EAN válido (docs/03). Vários portais (RJ legado/ENCAT, MG) mostram,
-- para itens de hortifruti/padaria/açougue, um código curto PRÓPRIO da loja —
-- não um código de barras (`eanDeCodigo`, em backend/src/parsers/html.ts,
-- corretamente recusa esse valor como `ean`, por não ter 8/12/13/14 dígitos).
-- Até aqui esse texto era descartado no parser sem deixar rastro nenhum.
--
-- Evidência real (dono do produto, dois cupons da MESMA loja com o MESMO item
-- comprado nas duas vezes): esse código é ESTÁVEL — a mesma loja sempre usa o
-- mesmo código para o mesmo item (é o SKU/registro interno dela). Isso é
-- candidato a uma chave de casamento determinística "loja + código interno →
-- produto_canonico", que dispensaria o casamento por texto quando a MESMA loja
-- reaparece com o MESMO item. A lógica de casamento em si é decisão do
-- data-scientist (extensão de C3.4/C3.5); esta migration só garante que o
-- dado SOBREVIVE até lá.
--
-- LGPD: campo PRIVADO — `item_cupom` já guarda `chave_acesso`, então uma coluna
-- a mais aqui não é problema novo. Não é dado pessoal (é SKU da LOJA, não do
-- consumidor), mas ainda SEM modelagem do lado COMPARTILHADO (`produto_alias`
-- hoje só conhece `texto_original`) — por isso o campo nasce só no privado; a
-- extensão do pool/alias fica para quando o casamento por código for desenhado.

alter table item_cupom
  add column if not exists codigo_loja text;

comment on column item_cupom.codigo_loja is
  'Código interno do item na loja (SKU), preservado do parser quando o campo de código da nota NÃO é um EAN válido. Ausente quando já há `ean` (seria redundante) ou a nota não expõe código de item. Candidato a chave de casamento determinística loja+código (decisão do data-scientist) — ver 20260804090000.';

-- `create or replace` com a MESMA assinatura da versão atual (20260728100000):
-- nenhum parâmetro novo, só mais um campo DENTRO do jsonb `p_itens` — mesmo
-- padrão da 20260725090000 (tipico_*). Preserva grants/revokes já aplicados
-- à função (o drop/recreate só é necessário quando o parâmetro TOPO muda).
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
  p_chave_hash              text default null,
  p_qr_payload              text default null
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
  --    O snapshot do típico e o código interno da loja entram JUNTO.
  delete from item_cupom where cupom_id = p_cupom_id;

  insert into item_cupom (
    cupom_id, produto_canonico_id, descricao_original, ean, codigo_loja,
    quantidade, unidade, valor_unitario, valor_total, desconto,
    tipico_mediana, tipico_unidade_base, tipico_escopo, tipico_n_observacoes
  )
  select
    p_cupom_id,
    nullif(i->>'produto_canonico_id', '')::uuid,
    i->>'descricao_original',
    nullif(i->>'ean', ''),
    nullif(i->>'codigo_loja', ''),
    (i->>'quantidade')::numeric,
    i->>'unidade',
    (i->>'valor_unitario')::numeric,
    (i->>'valor_total')::numeric,
    nullif(i->>'desconto', '')::numeric,
    nullif(i->>'tipico_mediana', '')::numeric,
    nullif(i->>'tipico_unidade_base', ''),
    nullif(i->>'tipico_escopo', '')::escopo_geo,
    nullif(i->>'tipico_n_observacoes', '')::integer
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
  --    `codigo_loja` NUNCA entra aqui — não tem coluna em observacao_preco, e
  --    não passa pelo gate (shared/anonimizacao/gate.ts). Fica só no privado.
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
    qr_payload     = coalesce(p_qr_payload, qr_payload),
    falha_motivo   = null,
    status         = 'processado',
    atualizado_em  = now()
  where id = p_cupom_id;

  return v_publicar;
end;
$$;

comment on function processar_cupom is
  'C9.3.1 + C9.2.1 — Processa o cupom numa transação única (loja + itens privados com snapshot do típico + código interno da loja + pool + status + QR saneado), com trava FOR UPDATE anti-corrida e dedup global do pool por hash da chave. Retorna false quando as observações foram retidas (chave já publicada).';
