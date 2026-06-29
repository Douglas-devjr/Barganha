-- C11.3 — Lançamento MANUAL de gôndola com moderação.
-- O usuário viu um preço na prateleira (sem cupom) e o informa. Como NÃO vem de
-- uma NFC-e verificada na SEFAZ, passa por CURADORIA antes de virar observação
-- no pool anônimo — evitando envenenar a base com preço inventado.
--
-- LGPD (docs/04): este registro é PRIVADO (controle de abuso) e carrega
-- usuario_id; ele NUNCA cruza para o pool. A publicação no pool, na aprovação,
-- passa pelo MESMO gate de anonimização do cupom (shared/ C1.4) — sem
-- usuario_id, sem vínculo. O id do autor fica só aqui, para barrar reincidente.
--
-- Depende de: dominio_tabelas (usuario, loja, observacao_preco, produto_canonico).

-- Ciclo de moderação. Espelha o enum TS `STATUS_MODERACAO` (shared/enums).
create type status_moderacao as enum ('pendente', 'aprovado', 'rejeitado');

create table lancamento_manual_moderacao (
  id             uuid primary key default gen_random_uuid(),
  -- PRIVADO: quem lançou (anti-abuso). Nunca vai ao pool.
  usuario_id     uuid not null references usuario (id) on delete cascade,
  ean            text not null,
  descricao      text not null,
  unidade        text not null,
  valor_unitario numeric not null,
  -- Geo pela LOJA (CNPJ), nunca pelo usuário (docs/04).
  loja_cnpj      text not null,
  municipio      text,
  uf             char(2),
  em_promocao    boolean not null default false,
  status         status_moderacao not null default 'pendente',
  -- Motivo da decisão (obrigatório na prática ao rejeitar; auditoria).
  motivo         text,
  criado_em      timestamptz not null default now(),
  decidido_em    timestamptz
);
comment on table lancamento_manual_moderacao is
  'C11.3 — Lançamento manual de preço (PRIVADO, com usuario_id p/ anti-abuso). Aprovação publica no pool via gate; rejeição não publica nada.';

-- Fila de curadoria: os pendentes, mais antigos primeiro.
create index lancamento_moderacao_fila_idx
  on lancamento_manual_moderacao (status, criado_em)
  where status = 'pendente';

-- Publicação ATÔMICA do lançamento aprovado (C11.3 + espírito de C9.3.1).
-- Transiciona pendente→aprovado e SÓ ENTÃO publica: loja (upsert) + observação
-- no pool. Idempotente — a 2ª chamada não encontra o status `pendente`, não
-- republica (o pool é append-only, sem como deduplicar a posteriori).
--
-- A observação chega JÁ anonimizada (passou pelo gate em shared/): aqui só há
-- campos de preço — sem usuario_id/cupom_id/chave.
create or replace function aprovar_lancamento_manual(
  p_id         uuid,
  p_loja       jsonb,
  p_observacao jsonb
) returns void
language plpgsql
as $$
begin
  -- Trava de transição: só publica o que estava de fato pendente.
  update lancamento_manual_moderacao
  set status = 'aprovado', decidido_em = now()
  where id = p_id and status = 'pendente';
  if not found then
    return; -- já decidido (ou inexistente): nada a publicar.
  end if;

  -- Loja (compartilhado) — upsert mínimo; não sobrescreve o que já existe do
  -- cupom (razão social etc.), só completa município/UF se faltarem.
  insert into loja (cnpj, municipio, uf, atualizado_em)
  values (
    p_loja->>'cnpj',
    nullif(p_loja->>'municipio', ''),
    nullif(p_loja->>'uf', ''),
    now()
  )
  on conflict (cnpj) do update set
    municipio     = coalesce(loja.municipio, excluded.municipio),
    uf            = coalesce(loja.uf, excluded.uf),
    atualizado_em = now();

  -- Pool anônimo (append) — só campos de preço; a anonimização já ocorreu.
  insert into observacao_preco (
    produto_canonico_id, loja_cnpj, municipio, uf,
    preco_normalizado, unidade_base, em_promocao, observado_em
  )
  values (
    (p_observacao->>'produto_canonico_id')::uuid,
    p_observacao->>'loja_cnpj',
    nullif(p_observacao->>'municipio', ''),
    nullif(p_observacao->>'uf', ''),
    (p_observacao->>'preco_normalizado')::numeric,
    p_observacao->>'unidade_base',
    coalesce((p_observacao->>'em_promocao')::boolean, false),
    (p_observacao->>'observado_em')::timestamptz
  );
end;
$$;

comment on function aprovar_lancamento_manual is
  'C11.3 — Aprova um lançamento manual numa transação única (transição + loja + pool). Idempotente: não republica se já decidido.';
