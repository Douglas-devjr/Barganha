-- Snapshot do TÍPICO da região no instante da compra, por item (lado privado).
--
-- Por que agora, antes de existir tela que use: `preco_estatistica` guarda só o
-- estado ATUAL — não há série histórica. A mediana de hoje não existe mais
-- amanhã, então este valor é IRRECUPERÁVEL se não for capturado na ingestão.
-- Mesma lógica de guardar o QR cru desde o dia 1 (decisão travada nº2).
--
-- Sem isso, a "economia real" (pagou × típico) só teria duas saídas ruins:
-- comparar compra antiga com pool de hoje (inflação vira economia fantasma, e o
-- número do usuário muda sozinho a cada sync) ou nascer sem histórico.
--
-- LGPD: os quatro campos são AGREGADO PÚBLICO (mediana anônima do município)
-- copiado para o lado privado. Nada anda no sentido contrário — `item_cupom`
-- continua sem qualquer caminho para o pool (docs/04).

alter table item_cupom
  add column if not exists tipico_mediana       numeric,
  add column if not exists tipico_unidade_base  text
    check (tipico_unidade_base in ('kg', 'L', 'un')),
  add column if not exists tipico_escopo        escopo_geo,
  add column if not exists tipico_n_observacoes integer;

comment on column item_cupom.tipico_mediana is
  'Mediana R$/tipico_unidade_base da região no processamento do cupom (faixa REGULAR, nunca promocional). NULL = item sem canônico ou região sem base.';
comment on column item_cupom.tipico_escopo is
  'Nível de onde a mediana veio. Nunca `loja`: comparar com a mediana da própria loja tende a zero e responde outra pergunta.';
comment on column item_cupom.tipico_n_observacoes is
  'Tamanho da base da mediana congelada. Viaja junto para a UI poder exigir um piso antes de afirmar economia.';

-- `create or replace` com a MESMA assinatura: preserva grants/revokes já
-- aplicados à função (20260722110000). Muda só o insert de item_cupom, que
-- passa a gravar o snapshot vindo dentro de `p_itens`.
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
  'C9.3.1 + C9.2.1 — Processa o cupom numa transação única (loja + itens privados com snapshot do típico + pool + status), com trava FOR UPDATE anti-corrida e dedup global do pool por hash da chave. Retorna false quando as observações foram retidas (chave já publicada).';
