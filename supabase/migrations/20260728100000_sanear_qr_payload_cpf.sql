-- LGPD — remove o CPF do consumidor do QR guardado (docs/04, decisão travada nº3).
--
-- O BURACO: os parsers de estado tomam o cuidado de nunca extrair o CPF do HTML
-- da nota, mas o QR **em si** pode carregá-lo. Na especificação ANTIGA do QR
-- Code da NFC-e (versão 1), o 4º campo do parâmetro `p` é o `cDest` — o CPF de
-- quem pediu a nota no CPF:
--
--   p=chNFe|nVersao|tpAmb|cDest|dhEmi|vNF|vICMS|digVal|cIdToken|cHashQRCode
--                          ^^^^^
--
-- Como `cupom.qr_payload` guarda o QR CRU desde o dia 1 (decisão travada nº2,
-- para o reprocessamento retroativo), o CPF entrava no banco pela porta dos
-- fundos — em texto puro, ao lado de `usuario_id`. A versão 2 do QR (atual) não
-- tem o campo, e para ela nada aqui tem efeito.
--
-- POR QUE SÓ DEPOIS DE `processado`, E NÃO NA INGESTÃO: em v1 o `cHashQRCode` é
-- calculado sobre a cadeia que INCLUI o `cDest`. Saneado antes da consulta, o
-- portal da SEFAZ rejeita a URL e o reprocessamento retroativo morre. Depois de
-- `processado` a consulta já aconteceu e o campo não serve mais para nada.
-- Cupom em `qr_capturado` ou `falha` NÃO é tocado: os dois ainda são alvo do
-- retro (C2.5) e precisam do payload íntegro.
--
-- Duas partes: (1) a RPC passa a gravar o payload saneado que o backend calcula
-- (`sanearQrPayload`, em shared/) na mesma transação que conclui o cupom;
-- (2) limpeza retroativa do que já está gravado.

-- =====================================================================
-- 1) `processar_cupom` ganha `p_qr_payload`.
-- =====================================================================

-- Parâmetro NOVO = assinatura nova. `create or replace` criaria um OVERLOAD, e
-- aí a chamada por nome do PostgREST ficaria ambígua ("function is not unique").
-- Derruba toda versão anterior antes de recriar. Dinâmico para casar a
-- assinatura sem depender dos type modifiers (char(2), numeric…).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'processar_cupom'
  loop
    execute format('drop function %s', r.assinatura);
  end loop;
end
$$;

create function processar_cupom(
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
  --    O snapshot do típico entra JUNTO: ele é lido no backend antes de o pool
  --    receber este cupom, para a base ser o típico de ANTES da própria compra.
  delete from item_cupom where cupom_id = p_cupom_id;

  insert into item_cupom (
    cupom_id, produto_canonico_id, descricao_original, ean,
    quantidade, unidade, valor_unitario, valor_total, desconto,
    tipico_mediana, tipico_unidade_base, tipico_escopo, tipico_n_observacoes
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
  --    `qr_payload` recebe aqui a versão SANEADA (sem o `cDest`/CPF da v1), na
  --    MESMA transação: um UPDATE à parte poderia falhar depois do commit do
  --    status e deixar o CPF guardado sem ninguém perceber. `coalesce` mantém o
  --    payload atual quando o chamador não manda nada (compatibilidade).
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
  'C9.3.1 + C9.2.1 — Processa o cupom numa transação única (loja + itens privados com snapshot do típico + pool + status + QR saneado), com trava FOR UPDATE anti-corrida e dedup global do pool por hash da chave. Retorna false quando as observações foram retidas (chave já publicada).';

-- A função nasceu de novo, então o revoke de 20260722110000 precisa ser
-- reaplicado: funções nascem com EXECUTE para PUBLIC e o PostgREST expõe
-- `public` como RPC. Só a service role (que ignora grants) deve chamá-la.
revoke execute on function processar_cupom(
  uuid, jsonb, timestamptz, char(2), jsonb, jsonb, numeric, numeric, boolean, text, text
) from public, anon, authenticated;

-- =====================================================================
-- 2) Limpeza retroativa: o que já está gravado.
-- =====================================================================

-- Só cupons `processado` — os demais ainda serão consultados na SEFAZ e
-- precisam do payload íntegro (ver cabeçalho). Os dois `regexp_replace` cobrem
-- o separador literal `|` e o percent-encoded `%7C`, conforme o portal; o
-- terceiro cobre `cDest`/`cpf` como parâmetro de query próprio. Cada um só
-- altera o que casa o padrão — payload sem PII sai idêntico ao que entrou.
update cupom
set qr_payload = regexp_replace(
      regexp_replace(
        regexp_replace(qr_payload, '([?&])(cDest|cpf)=[^&#]*', '\1\2=', 'gi'),
        '(p=[^&#|]+\|1\|[^|]*\|)[^|]*', '\1'
      ),
      '(p=[^&#%]+%7C1%7C[^%]*%7C)[^%]*', '\1', 'i'
    ),
    atualizado_em = now()
where status = 'processado'
  and (
    qr_payload ~* '[?&](cDest|cpf)=[^&#]+'
    or qr_payload ~ 'p=[^&#|]+\|1\|[^|]*\|[^|]+'
    or qr_payload ~* 'p=[^&#%]+%7C1%7C[^%]*%7C[^%]+'
  );

comment on column cupom.qr_payload is
  'QR cru da NFC-e (PRIVADO), guardado para reprocessamento retroativo. Após o '
  'cupom chegar a `processado`, o CPF do consumidor (campo cDest, só na versão 1 '
  'do QR) é removido — ver 20260728100000 e shared/anonimizacao/qr-payload.ts.';
