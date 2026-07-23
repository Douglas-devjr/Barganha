-- Auditoria — fila de recálculo + `criado_em` do pool granular ao DIA.
--
-- Dois problemas resolvidos de uma vez, porque a solução é a mesma peça:
--
-- 1) ANTI-REMONTAGEM DA CESTA (docs/04, decisão travada #3). O gate já
--    arredonda `observado_em` para o dia justamente para que
--    `GROUP BY (loja_cnpj, observado_em)` não reconstrua "estes itens juntos".
--    Mas `criado_em` continuava com precisão de microssegundo e é IDÊNTICO para
--    todos os itens de um mesmo cupom (uma única transação) — ou seja, era um
--    identificador de cesta melhor que o campo que fomos ao trabalho de
--    arredondar. Passa a ser granular ao dia, como o irmão.
--
-- 2) MAS o job de recálculo (C3.1/C10) usava exatamente essa precisão para
--    achar "produtos com observação nos últimos N minutos". Com `criado_em` no
--    dia isso deixaria de funcionar — então o sinal de trabalho pendente sai do
--    pool e vira uma FILA explícita, `produto_recalculo_pendente`, alimentada
--    por trigger em TODA inserção no pool (cupom, lançamento manual aprovado,
--    republicação). Além de destravar o item 1, é mais barato: o job lê uma
--    tabela pequena em vez de varrer `observacao_preco` por timestamp.
--
-- A fila não guarda nada de pessoal: só o id do produto e quando foi marcado.

-- =====================================================================
-- 1) Fila de recálculo pendente.
-- =====================================================================
create table if not exists public.produto_recalculo_pendente (
  produto_canonico_id uuid primary key references public.produto_canonico (id) on delete cascade,
  marcado_em          timestamptz not null default now()
);

comment on table public.produto_recalculo_pendente is
  'Produtos com observação nova aguardando recálculo de preco_estatistica. '
  'Fila de trabalho (sem dado pessoal); substitui a varredura por observacao_preco.criado_em.';

-- Ordem de drenagem do job (mais antigos primeiro, dentro da janela).
create index if not exists produto_recalculo_pendente_marcado_idx
  on public.produto_recalculo_pendente (marcado_em);

-- RLS explícito na migração (não depender do event trigger do banco de nuvem):
-- ligado e SEM política = nega tudo para anon/authenticated.
alter table public.produto_recalculo_pendente enable row level security;

-- =====================================================================
-- 2) Trigger: toda inserção no pool marca o produto como pendente.
--    Statement-level com transition table — um único UPSERT por lote de
--    observações, em vez de um por linha.
-- =====================================================================
create or replace function public.marcar_recalculo_pendente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into produto_recalculo_pendente (produto_canonico_id, marcado_em)
  select distinct n.produto_canonico_id, now()
  from novas n
  on conflict (produto_canonico_id) do update set marcado_em = now();
  return null;
end;
$$;

comment on function public.marcar_recalculo_pendente is
  'Enfileira o recálculo de preco_estatistica dos produtos que receberam observação.';

-- Roda por trigger interno; não precisa ser chamável como RPC (advisors 0028/0029).
revoke execute on function public.marcar_recalculo_pendente() from public, anon, authenticated;

drop trigger if exists observacao_preco_marca_recalculo on public.observacao_preco;
create trigger observacao_preco_marca_recalculo
  after insert on public.observacao_preco
  referencing new table as novas
  for each statement execute function public.marcar_recalculo_pendente();

-- Semente: o que já está no pool entra na fila uma vez, para a primeira rodada
-- do job após esta migração reconstruir tudo que porventura ficou para trás.
insert into public.produto_recalculo_pendente (produto_canonico_id, marcado_em)
select distinct produto_canonico_id, now() from public.observacao_preco
on conflict (produto_canonico_id) do update set marcado_em = now();

-- =====================================================================
-- 3) `criado_em` do pool passa a ser granular ao DIA (ver cabeçalho).
--    Continua timestamptz (não muda o tipo da coluna nem o índice); o que muda
--    é a RESOLUÇÃO gravada. Backfill trunca o histórico já existente.
-- =====================================================================
alter table public.observacao_preco
  alter column criado_em set default date_trunc('day', now());

update public.observacao_preco
set criado_em = date_trunc('day', criado_em)
where criado_em <> date_trunc('day', criado_em);

comment on column public.observacao_preco.criado_em is
  'Dia da publicação no pool (truncado). Granular ao dia de propósito: com '
  'precisão de instante, todos os itens de um cupom compartilham o valor e a '
  'cesta seria remontável por GROUP BY (loja_cnpj, criado_em) — docs/04.';
