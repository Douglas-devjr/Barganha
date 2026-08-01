-- C8.4 — Push de verdade para alertas de preço.
--
-- Hoje o alerta só dispara com o app ABERTO (checagem local contra o cache
-- SQLite quando a tela Início ganha foco) — não existe notificação push, que é
-- o comportamento que qualquer pessoa espera de um "alerta". Para avisar com o
-- app fechado, algo precisa rodar do lado do servidor: um espelho do alerta e
-- o token de push do aparelho, mais um job periódico (GitHub Actions, mesmo
-- padrão de recalculo-estatistica) que LÊ `preco_estatistica` e dispara via
-- Expo Push quando o preço cruza o alvo.
--
-- LGPD (docs/04, decisão travada #3) — fronteira de privacidade preservada:
--
--  • `alerta_preco` e `dispositivo_push` são dado PRIVADO do usuário (mesma
--    categoria de `cupom`/`item_cupom`), nunca do pool. `usuario_id` e o token
--    de push do aparelho NUNCA cruzam para `observacao_preco` nem entram na
--    mediana compartilhada.
--  • O job de avaliação (C8.4, passo 8) só FAZ SELECT em `preco_estatistica` —
--    nunca escreve nela. O alerta é consumidor da estatística, não influencia
--    o veredito (muro da neutralidade, decisão travada #8: quem tem alerta
--    configurado não pesa mais na mediana de ninguém).
--  • Token de push é identificador de dispositivo → retenção com TTL
--    (`visto_em`, purgar >90 dias sem entrega e em ticket `DeviceNotRegistered`
--    do Expo) — ver gate de privacidade do plano C8.4.
--
-- Depende de: dominio_tabelas (usuario, produto_canonico).

-- =====================================================================
-- 1) alerta_preco — o alvo que o usuário armou para um produto.
-- =====================================================================
create table if not exists public.alerta_preco (
  usuario_id          uuid          not null references public.usuario (id) on delete cascade,
  produto_canonico_id uuid          not null references public.produto_canonico (id) on delete cascade,
  preco_alvo          numeric(12,4) not null check (preco_alvo > 0),
  -- Chave normalizada de município/UF — a MESMA família de `chaveMunicipio()`
  -- (shared/src/estatistica/normalizacao.ts, formato "UF:MUNICIPIO", ex.
  -- "SP:SAO PAULO"), a mesma usada por `escolherEstatisticaRegional` no app e
  -- que o job vai casar contra `preco_estatistica.escopo_id` (fallback
  -- hierárquico loja→cidade→região→UF). NÃO é o enum `escopo_geo` (o tipo do
  -- nível de agregação usado em `preco_estatistica.escopo`) — o nome bate por
  -- coincidência de vocabulário; aqui é sempre texto, a chave geográfica em
  -- si, nunca o nível. Documentado aqui para não nascer um formato novo.
  escopo_geo          text          not null,
  criado_em           timestamptz   not null default now(),
  -- Dedupe: não-nulo = já disparou o push e está "armado esperando reverter".
  -- O job só dispara de novo depois que `rearmado_em` for setado.
  disparado_em        timestamptz,
  -- Rearma quando o preço observado volta a subir acima de preco_alvo * 1.05
  -- (histerese — evita ping-pong de push em torno do alvo).
  rearmado_em         timestamptz,
  -- Um alvo por produto por usuário: definir de novo substitui o anterior.
  primary key (usuario_id, produto_canonico_id)
);

comment on table public.alerta_preco is
  'C8.4 — Alvo de preço por usuário×produto (PRIVADO). Espelho no servidor do '
  'alerta local para permitir push com o app fechado. Nunca cruza para o pool '
  'nem influencia a mediana (docs/04, decisão travada #8).';
comment on column public.alerta_preco.escopo_geo is
  'Chave normalizada de município/UF (mesma família de chaveMunicipio() em '
  'shared/src/dominio) — NÃO confundir com o enum escopo_geo de '
  'preco_estatistica.escopo (nível de agregação). Aqui é sempre a chave, nunca '
  'o nível.';
comment on column public.alerta_preco.disparado_em is
  'Não-nulo = já disparou o push para este alvo (dedupe). Limpo/rearmado pelo '
  'job quando o preço observado sobe de novo acima de preco_alvo * 1.05.';
comment on column public.alerta_preco.rearmado_em is
  'Quando o job rearma o alerta (preço voltou a subir). Histerese contra '
  'ping-pong de push em torno do alvo.';

-- Join do job: para um produto que acabou de atualizar em preco_estatistica,
-- achar rápido os alertas daquele produto no mesmo recorte geográfico.
create index if not exists alerta_preco_produto_escopo_idx
  on public.alerta_preco (produto_canonico_id, escopo_geo);

-- RLS explícito na migração (não depender do event trigger do banco de nuvem
-- nem do fato de anon/authenticated já não terem GRANT desde 20260724090000):
-- ligado e com política = só o dono, mesmo se os grants voltarem por engano.
-- O backend real fala pela service role (ignora RLS).
alter table public.alerta_preco enable row level security;

drop policy if exists alerta_preco_proprio_all on public.alerta_preco;
create policy alerta_preco_proprio_all on public.alerta_preco
  for all
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);

-- =====================================================================
-- 2) dispositivo_push — token Expo do aparelho, para onde o job envia.
-- =====================================================================
create table if not exists public.dispositivo_push (
  -- Formato ExponentPushToken[...] do Expo. PK natural: reinstalar/relogar no
  -- mesmo aparelho gera o mesmo token e o upsert só atualiza o dono.
  token      text        primary key,
  usuario_id uuid        not null references public.usuario (id) on delete cascade,
  plataforma text        not null check (plataforma in ('ios', 'android')),
  criado_em  timestamptz not null default now(),
  -- Último push entregue com sucesso (ticket do Expo sem erro). Usado para
  -- TTL/purga: token sem `visto_em` há >90 dias é considerado morto.
  visto_em   timestamptz
);

comment on table public.dispositivo_push is
  'C8.4 — Token de push Expo por aparelho (PRIVADO, identificador de '
  'dispositivo). Retenção com TTL: purgar >90 dias sem visto_em ou em ticket '
  'DeviceNotRegistered do Expo.';
comment on column public.dispositivo_push.visto_em is
  'Último push entregue com sucesso. Null = nunca confirmado. Base do TTL de '
  'purga (>90 dias) — não é histórico de uso, só sinal de token vivo/morto.';

-- Buscar os tokens de um usuário na hora de enviar / apagar conta.
create index if not exists dispositivo_push_usuario_idx
  on public.dispositivo_push (usuario_id);

-- RLS explícito, mesmo racional do item 1.
alter table public.dispositivo_push enable row level security;

drop policy if exists dispositivo_push_proprio_all on public.dispositivo_push;
create policy dispositivo_push_proprio_all on public.dispositivo_push
  for all
  using ((select auth.uid()) = usuario_id)
  with check ((select auth.uid()) = usuario_id);
