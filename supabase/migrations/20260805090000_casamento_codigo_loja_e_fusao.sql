-- C3.6.1 — Casamento por (loja + código interno) e FUSÃO de produtos canônicos.
--
-- Contexto (o que estava quebrado):
--
--  1. `produto_alias` era WRITE-ONLY. A curadoria confirmava um casamento por
--     texto, a linha era gravada — e NADA, em lugar nenhum, a lia. O curador
--     decidia no vazio: o cupom seguinte com a mesma descrição continuava indo
--     para `casarPorDescricao` (acha-ou-cria) e recriando o fragmento.
--
--  2. A FUSÃO de canônicos, citada na documentação como a saída para a
--     fragmentação ("a curadoria resolve fundindo via produto_alias"), nunca
--     existiu. Não havia como juntar dois canônicos do mesmo produto físico.
--
--  3. Para item SEM EAN, a identidade do produto ERA a string exata. Qualquer
--     mudança de escrita no PDV (abreviação nova, "PROMO" no nome, troca de
--     sistema) criava um canônico novo e PARTIA a série de preço em duas, em
--     silêncio: a mediana voltava a n=1 e o veredito seguia exibindo número
--     com cara de confiança. Esse é o motivo real da chave nova — não é
--     economia de CPU (o caminho por descrição já é um SELECT indexado).
--
-- Evidência que originou a chave (dono do produto, dois cupons da MESMA loja
-- com o MESMO item): o código interno mostrado pelo portal é ESTÁVEL — é o
-- SKU/registro da loja, não um número por transação. A coluna que o preserva
-- entrou na 20260804090000 (`item_cupom.codigo_loja`); aqui ela vira chave de
-- casamento no lado COMPARTILHADO.
--
-- LGPD (docs/04): `produto_codigo_loja` é CATÁLOGO DE LOJA, não observação.
-- CNPJ é estabelecimento, não pessoa; a tabela não tem `usuario_id`, `cupom_id`
-- nem `chave_acesso`. `ultimo_visto` é DATE (dia), NUNCA timestamp: com hora,
-- duas linhas do mesmo instante reconstruiriam "estes itens estavam na mesma
-- cesta", que é exatamente a impressão digital que a regra 2 de docs/04 existe
-- para impedir (o mesmo motivo de o gate zerar a hora de `observado_em`).
-- A tabela é INTERNA: não é servida pela API do app nem pelo delta sync.
--
-- Depende de: dominio_tabelas (produto_canonico, produto_alias, loja),
-- 20260804090000 (item_cupom.codigo_loja).

-- =====================================================================
-- 1) produto_alias — passa a ser LEGÍVEL pelo casamento.
-- =====================================================================

-- Sem a unidade-base, um alias de "LEITE" ligaria um produto de kg a um de L.
alter table public.produto_alias
  add column if not exists unidade_base text;

comment on column public.produto_alias.unidade_base is
  'Unidade-base do canônico alvo no momento da confirmação. Parte da chave de '
  'busca do casamento (C3.6.1) — impede casar escalas incomparáveis.';

-- Preenche o que já existe a partir do próprio canônico (linhas antigas nasceram
-- sem a coluna).
update public.produto_alias a
   set unidade_base = c.unidade_base
  from public.produto_canonico c
 where a.produto_canonico_id = c.id
   and a.unidade_base is null;

-- Espelho SQL de `normalizarDescricao` (shared/src/estatistica/normalizacao.ts):
-- sem acento, maiúsculas, espaços colapsados. Feito com `translate` em vez de
-- `unaccent` de propósito — a extensão não está instalada neste banco, e uma
-- migração não é lugar de estrear dependência que ninguém pediu. Cobre o
-- repertório do português, que é o universo das descrições de NFC-e.
create or replace function public.normalizar_descricao_sql(p_texto text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(
    upper(translate(
      p_texto,
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
    )),
    '\s+', ' ', 'g'
  ));
$$;

comment on function public.normalizar_descricao_sql is
  'Espelho SQL de normalizarDescricao() (shared) — sem acento, maiúsculas, '
  'espaços colapsados. Usado para normalizar aliases legados (C3.6.1). A fonte '
  'única do runtime continua sendo a função TypeScript.';

-- O casamento busca por texto NORMALIZADO; alias gravado cru ficaria invisível
-- (o bug que esta migração fecha). Alinha o histórico com essa forma.
update public.produto_alias
   set texto_original = public.normalizar_descricao_sql(texto_original)
 where texto_original is not null
   and texto_original <> public.normalizar_descricao_sql(texto_original);

-- Desduplica ANTES do índice único: sem isto a migração falharia num banco que
-- já tenha duas confirmações para o mesmo texto. Mantém a MAIS RECENTE — é a
-- decisão de curadoria mais atual.
delete from public.produto_alias a
 using public.produto_alias b
 where a.confirmado
   and b.confirmado
   and a.texto_original = b.texto_original
   and a.unidade_base is not distinct from b.unidade_base
   and (a.criado_em, a.id) < (b.criado_em, b.id);

-- Um texto confirmado resolve para UM canônico. Parcial: sugestões não
-- confirmadas podem coexistir à vontade (elas nunca casam sozinhas, docs/06).
create unique index if not exists produto_alias_texto_unidade_uniq
  on public.produto_alias (texto_original, unidade_base)
  where confirmado;

-- =====================================================================
-- 2) produto_codigo_loja — a chave (loja, código interno) → canônico.
-- =====================================================================

create table if not exists public.produto_codigo_loja (
  loja_cnpj            text        not null references public.loja (cnpj),
  -- Código como o portal mostra (só trim/upper). NÃO forçamos dígitos: o
  -- `cProd` da NFe pode ser alfanumérico (docs/03).
  codigo               text        not null,
  produto_canonico_id  uuid        not null references public.produto_canonico (id) on delete cascade,
  -- Guarda de VETO barata: kg ≠ un é outro produto, sem precisar comparar texto.
  unidade_base         text        not null check (unidade_base in ('kg', 'L', 'un')),
  -- Descrição normalizada de quando o mapeamento nasceu/foi reconfirmado. É a
  -- base da guarda de similaridade que detecta reuso de SKU pela loja.
  descricao_referencia text        not null,
  -- Âncora de preço (EWMA lenta das observações aceitas). NÃO é o típico do
  -- produto (isso é `preco_estatistica`): é um valor barato, já carregado com a
  -- linha, para sinalizar "este código virou outro produto". Nunca VETA.
  preco_referencia     numeric,
  -- EAN visto na MESMA loja para este código — ponte EAN ↔ código interno,
  -- capturada de graça quando a loja declara os dois.
  ean_visto            text,
  -- Como o mapeamento nasceu. INVARIANTE: só nasce de um caminho igual ou mais
  -- forte que o casamento por descrição — nunca de similaridade sem confirmação.
  origem               text        not null default 'descricao_exata'
                                   check (origem in ('ean', 'descricao_exata', 'humano')),
  -- `suspeito`/`dormente` exigem limiar de similaridade mais ESTRITO para
  -- voltar a valer — é assim que uma linha marcada se recupera sozinha quando a
  -- descrição volta ao normal, sem precisar de curadoria.
  status               text        not null default 'ativo'
                                   check (status in ('ativo', 'suspeito', 'dormente')),
  motivo_suspeita      text,
  hits                 integer     not null default 1,
  -- DIA, nunca timestamp — ver a nota de LGPD no cabeçalho.
  ultimo_visto         date        not null default current_date,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  -- Um código, um significado por vez. Se a loja reciclar o SKU, isso vira um
  -- CONFLITO detectável (a guarda recusa e marca `suspeito`) em vez de duas
  -- linhas divergindo em silêncio.
  primary key (loja_cnpj, codigo)
);

comment on table public.produto_codigo_loja is
  'C3.6.1 — Mapeia (loja + código interno/SKU) → produto_canonico. CACHE de uma '
  'decisão tomada por um caminho igual ou mais forte (EAN, alias humano ou '
  'descrição exata); NUNCA cria produto_canonico e nunca é fonte primária de '
  'identidade. Catálogo de LOJA (compartilhado, sem usuario_id/cupom_id) — '
  'interno, não servido pela API do app nem pelo delta sync.';

comment on column public.produto_codigo_loja.preco_referencia is
  'Âncora de preço (R$/unidade-base, EWMA lenta) só para SINALIZAR troca de '
  'item. Não é o típico do produto e nunca veta um casamento sozinha: promoção '
  'e inflação existem.';

-- Raiz do CNPJ (8 dígitos): filiais de uma rede a compartilham e costumam
-- compartilhar o ERP — base do alargamento por rede, que fica atrás de flag no
-- backend porque é HIPÓTESE a medir, não fato.
alter table public.produto_codigo_loja
  add column if not exists raiz_cnpj text
  generated always as (left(regexp_replace(loja_cnpj, '\D', '', 'g'), 8)) stored;

create index if not exists produto_codigo_loja_rede_idx
  on public.produto_codigo_loja (raiz_cnpj, codigo)
  where status = 'ativo';

-- Fila da curadoria: o que o casamento recusou e está esperando um humano.
create index if not exists produto_codigo_loja_suspeito_idx
  on public.produto_codigo_loja (status, atualizado_em)
  where status <> 'ativo';

-- Reaponte da fusão (repontar tudo do perdedor) e auditoria por produto.
create index if not exists produto_codigo_loja_canonico_idx
  on public.produto_codigo_loja (produto_canonico_id);

-- RLS explícito: regra do projeto para toda tabela nova em `public` (o event
-- trigger `ensure_rls` vive só no banco de nuvem; sem isto, um `db reset` a
-- partir das migrações deixaria a tabela ABERTA para a anon key). Ligado e sem
-- política = nega tudo para anon/authenticated; só a service role escreve.
alter table public.produto_codigo_loja enable row level security;

-- =====================================================================
-- 3) registrar_uso_codigo_loja — hit aceito, contado NO BANCO.
-- =====================================================================
-- `hits` sobe no banco de propósito: um read-modify-write no backend perderia
-- contagem quando dois cupons do mesmo código são processados ao mesmo tempo, e
-- `hits` é justamente a métrica de "a chave está pegando" (docs/06).
create or replace function public.registrar_uso_codigo_loja(
  p_loja_cnpj            text,
  p_codigo               text,
  p_descricao_referencia text,
  p_preco_referencia     numeric default null,
  p_dia                  date    default current_date
) returns void
language sql
set search_path = public
as $$
  update public.produto_codigo_loja
     set hits                 = hits + 1,
         ultimo_visto         = greatest(ultimo_visto, p_dia),
         descricao_referencia = coalesce(nullif(p_descricao_referencia, ''), descricao_referencia),
         preco_referencia     = coalesce(p_preco_referencia, preco_referencia),
         -- Uso aceito reabilita a linha: é assim que um `suspeito` causado por
         -- uma descrição estranha isolada se recupera sem intervenção.
         status               = 'ativo',
         motivo_suspeita      = null,
         atualizado_em        = now()
   where loja_cnpj = p_loja_cnpj
     and codigo    = p_codigo;
$$;

comment on function public.registrar_uso_codigo_loja is
  'C3.6.1 — Contabiliza um uso ACEITO do mapeamento loja+código (hits, '
  'ultimo_visto, âncora de preço) e reabilita a linha. Incremento no banco para '
  'não perder contagem em ingestões simultâneas.';

-- =====================================================================
-- 4) fundir_produto_canonico — a operação que faltava.
-- =====================================================================
-- Atômica por necessidade: uma fusão pela metade (pool movido, histórico
-- privado não) deixa o banco num estado que nenhuma tela sabe exibir e que
-- nenhum job sabe consertar.
--
-- As guardas de INTENÇÃO (mesma unidade-base, não fundir dois EANs distintos,
-- não perder o EAN do perdedor) ficam no serviço `ServicoFusaoCanonicos`, que é
-- onde dá para explicar o erro ao curador. Aqui ficam só as que protegem a
-- INTEGRIDADE do banco — as que, se violadas, corrompem dado.
create or replace function public.fundir_produto_canonico(
  p_perdedor uuid,
  p_vencedor uuid
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_perdedor  record;
  v_vencedor  record;
  v_obs       integer := 0;
  v_itens     integer := 0;
  v_aliases   integer := 0;
  v_codigos   integer := 0;
begin
  if p_perdedor = p_vencedor then
    raise exception 'Perdedor e vencedor são o mesmo produto (%).', p_perdedor;
  end if;

  -- FOR UPDATE nos dois: serializa duas fusões concorrentes que se cruzem
  -- (A→B e B→A ao mesmo tempo apagariam os dois lados).
  select * into v_perdedor from public.produto_canonico where id = p_perdedor for update;
  if not found then
    raise exception 'Produto perdedor % não existe.', p_perdedor;
  end if;
  select * into v_vencedor from public.produto_canonico where id = p_vencedor for update;
  if not found then
    raise exception 'Produto vencedor % não existe.', p_vencedor;
  end if;

  if v_perdedor.unidade_base is distinct from v_vencedor.unidade_base then
    raise exception 'Unidades-base diferentes (% ≠ %) — fusão misturaria escalas de preço.',
      v_perdedor.unidade_base, v_vencedor.unidade_base;
  end if;

  -- 1) Pool anônimo — o que faz as duas amostras virarem uma série só.
  update public.observacao_preco set produto_canonico_id = p_vencedor
   where produto_canonico_id = p_perdedor;
  get diagnostics v_obs = row_count;

  -- 2) Histórico PRIVADO. Sem isto, o item do usuário apontaria para um
  --    canônico apagado e a tela de histórico perderia o produto.
  update public.item_cupom set produto_canonico_id = p_vencedor
   where produto_canonico_id = p_perdedor;
  get diagnostics v_itens = row_count;

  -- 3) Aliases de texto. `do nothing` no conflito: se o texto já resolve para o
  --    vencedor, a linha do perdedor é redundante e morre no cascade.
  update public.produto_alias a set produto_canonico_id = p_vencedor
   where a.produto_canonico_id = p_perdedor
     and not exists (
       select 1 from public.produto_alias b
        where b.confirmado
          and b.texto_original = a.texto_original
          and b.unidade_base is not distinct from a.unidade_base
          and b.produto_canonico_id = p_vencedor
     );
  get diagnostics v_aliases = row_count;

  -- 4) Mapeamentos loja+código.
  update public.produto_codigo_loja set produto_canonico_id = p_vencedor, atualizado_em = now()
   where produto_canonico_id = p_perdedor;
  get diagnostics v_codigos = row_count;

  -- 5) Alertas de preço (PK usuario+produto). O alvo que o usuário definiu
  --    sobre o produto SOBREVIVENTE prevalece; o do perdedor morre no cascade.
  update public.alerta_preco a set produto_canonico_id = p_vencedor
   where a.produto_canonico_id = p_perdedor
     and not exists (
       select 1 from public.alerta_preco b
        where b.usuario_id = a.usuario_id and b.produto_canonico_id = p_vencedor
     );

  -- 6) Denúncias abertas seguem o produto que sobrevive.
  update public.denuncia_preco set produto_canonico_id = p_vencedor
   where produto_canonico_id = p_perdedor;

  -- 7) Memória da fusão. LOAD-BEARING: sem este alias, o próximo cupom com a
  --    descrição do perdedor não acharia mais o canônico (apagado logo abaixo)
  --    e criaria o fragmento de novo — a fusão se desfaria sozinha.
  if v_perdedor.descricao_normalizada is not null
     and v_perdedor.descricao_normalizada <> '' then
    insert into public.produto_alias
      (produto_canonico_id, texto_original, unidade_base, confianca, confirmado)
    values
      (p_vencedor, v_perdedor.descricao_normalizada, v_perdedor.unidade_base, 1, true)
    on conflict (texto_original, unidade_base) where confirmado
      do update set produto_canonico_id = excluded.produto_canonico_id;
  end if;

  -- 8) Some com o perdedor. `preco_estatistica`, `produto_recalculo_pendente` e
  --    o que sobrou de alias/alerta caem por cascade. O recálculo do vencedor é
  --    disparado pelo serviço, fora da transação.
  delete from public.produto_canonico where id = p_perdedor;

  return jsonb_build_object(
    'observacoes', v_obs,
    'itens',       v_itens,
    'aliases',     v_aliases,
    'codigos',     v_codigos
  );
end;
$$;

comment on function public.fundir_produto_canonico is
  'C3.6.1 — Funde dois produto_canonico numa transação: reaponta pool, '
  'histórico privado, aliases, mapeamentos loja+código, alertas e denúncias; '
  'grava o alias da descrição do perdedor (senão a fusão se desfaz no próximo '
  'cupom) e apaga o perdedor. Guardas de intenção ficam em ServicoFusaoCanonicos.';

-- Funções nascem com EXECUTE para PUBLIC e o PostgREST expõe `public` como RPC.
-- Ambas escrevem no pool/catálogo compartilhado — o caminho que a camada de
-- anonimização monopoliza (decisão travada #3). Mesmo revoke das irmãs
-- (`processar_cupom`, `aprovar_lancamento_manual`, 20260722110000).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'fundir_produto_canonico',
         'registrar_uso_codigo_loja',
         'normalizar_descricao_sql'
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.assinatura);
  end loop;
end
$$;
