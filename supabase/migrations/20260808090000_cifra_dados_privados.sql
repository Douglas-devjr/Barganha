-- C9.2.2 (b6) — Cifra reversível de `cupom.chave_acesso` e `item_cupom.descricao_original`.
-- Ver docs/19-ambientes-e-endurecimento.md §8 (desenho completo + procedimento de rotação).
--
-- Por que corte limpo (sem migração de dados em duas fases): a base de
-- produção está praticamente vazia — o produto ainda não passou pelo gate do
-- beta fechado (docs/15) e não há usuário real com histórico real (confirmado
-- em docs/19 §8, redigido junto com esta migração). Não há dado de produção a
-- preservar/recifrar aqui.
--
-- Por que a cifra NÃO é feita em SQL (pgcrypto): a chave-mestra precisa ficar
-- FORA do banco (variável de ambiente do backend). `pgcrypto` cifraria/decifraria
-- passando a chave como PARÂMETRO de uma query — e ela vazaria para
-- `pg_stat_statements` e para os logs do Postgres, o que contraria "fora do
-- banco". A cifra roda em Node (`backend/src/seguranca/cifra.ts`, AES-256-GCM);
-- esta migração só troca o formato das colunas — de texto puro para o blob
-- opaco que o backend produz.
--
-- O que muda:
--   1) cupom.chave_acesso (texto puro)       → chave_acesso_cifrada (blob AES-256-GCM,
--                                                versionado) + chave_acesso_hash
--                                                (SHA-256 determinístico, para idempotência).
--   2) item_cupom.descricao_original (texto) → descricao_cifrada (blob AES-256-GCM).
--   3) cupom_usuario_chave_uniq (sobre chave_acesso) → cupom_usuario_chave_hash_uniq
--      (sobre chave_acesso_hash). A cifra é NÃO-determinística (IV aleatório por
--      linha) — nunca dá para indexar por igualdade sobre o blob. `chave_acesso_hash`
--      é NOVA e SEPARADA do hash global de dedup do pool em `chave_publicada.chave_hash`
--      (C9.2.1): mesmo algoritmo (SHA-256 da chave crua), tabelas e propósitos
--      diferentes — uma é idempotência POR USUÁRIO, a outra é dedup GLOBAL do pool.
--
-- `processar_cupom` (RPC) muda MINIMAMENTE: só o nome da coluna/chave do jsonb
-- que grava a descrição do item — ela já recebia um TEXTO opaco de bagagem
-- (agora é cifrado em vez de claro) e nunca comparou/agrupou por esse campo.

-- 1) cupom — novas colunas (nullable: chave_acesso já era opcional).
alter table public.cupom
  add column chave_acesso_cifrada text,
  add column chave_acesso_hash   text;

comment on column public.cupom.chave_acesso_cifrada is
  'C9.2.2 (b6) — chave de acesso da NFC-e, cifrada em Node (AES-256-GCM, chave fora do banco). Formato "<versao>:<iv>:<tag>:<cifrado>" (base64), ver backend/src/seguranca/cifra.ts. Decifrada sob demanda para o reprocessamento retroativo (C2.5) consultar a SEFAZ de novo — NÃO é hash, é reversível.';
comment on column public.cupom.chave_acesso_hash is
  'C9.2.2 (b6) — SHA-256 determinístico da chave de acesso crua (mesmo padrão de hashChavePool). Só serve à idempotência POR USUÁRIO (cupom_usuario_chave_hash_uniq) — separado do hash global de dedup do pool em chave_publicada.chave_hash (C9.2.1), mesmo cálculo, tabelas e finalidades diferentes.';

-- Substitui o índice único sobre a coluna que deixa de existir.
drop index if exists public.cupom_usuario_chave_uniq;

create unique index cupom_usuario_chave_hash_uniq
  on public.cupom (usuario_id, chave_acesso_hash)
  where chave_acesso_hash is not null;

alter table public.cupom drop column chave_acesso;

-- 2) item_cupom — nova coluna. Adiciona nullable, remove a antiga, só então
--    aplica NOT NULL: se por acaso já existisse alguma linha (não deveria,
--    base vazia), a migração falha alto em vez de gravar NULL em silêncio.
alter table public.item_cupom
  add column descricao_cifrada text;

comment on column public.item_cupom.descricao_cifrada is
  'C9.2.2 (b6) — descrição original do item da NFC-e, cifrada em Node (AES-256-GCM, chave fora do banco). Mesmo formato de cupom.chave_acesso_cifrada. Nunca comparada/agrupada por igualdade — só decifrada para exibir o histórico ao próprio dono.';

alter table public.item_cupom drop column descricao_original;
alter table public.item_cupom alter column descricao_cifrada set not null;

-- 3) `processar_cupom` — MESMA assinatura (preserva grants/revokes já
--    aplicados, padrão já usado em 20260725090000/20260804090000): só o insert
--    de item_cupom muda, escrevendo em descricao_cifrada a partir da chave
--    `descricao_cifrada` do jsonb (o Node já manda o valor CIFRADO ali — a
--    função SQL nunca vê o texto em claro).
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
  --    `descricao_cifrada` chega JÁ cifrada do Node (C9.2.2/b6) — a função SQL
  --    nunca vê a descrição em claro.
  delete from item_cupom where cupom_id = p_cupom_id;

  insert into item_cupom (
    cupom_id, produto_canonico_id, descricao_cifrada, ean, codigo_loja,
    quantidade, unidade, valor_unitario, valor_total, desconto,
    tipico_mediana, tipico_unidade_base, tipico_escopo, tipico_n_observacoes
  )
  select
    p_cupom_id,
    nullif(i->>'produto_canonico_id', '')::uuid,
    i->>'descricao_cifrada',
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
  'C9.3.1 + C9.2.1 + C9.2.2(b6) — Processa o cupom numa transação única (loja + itens privados com descrição CIFRADA + snapshot do típico + código interno da loja + pool + status + QR saneado), com trava FOR UPDATE anti-corrida e dedup global do pool por hash da chave. Retorna false quando as observações foram retidas (chave já publicada).';
