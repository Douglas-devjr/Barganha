-- C13.2 — Backend da assinatura: tabela privada de plano, exposta na conta.
--
-- CONTEXTO (docs/21). C13.1 já fixou a regra pura (`shared/src/plano/direitos.ts`,
-- `Plano = 'gratis' | 'plus'`): o que cada plano pode. Até aqui o plano só
-- existia no APARELHO (interruptor de teste nas Configurações) — não havia
-- nenhuma fonte de verdade no servidor. Esta migração cria essa fonte.
--
-- AINDA SEM COBRANÇA. Nada aqui fala com o Google Play Billing (C13.3) nem
-- conta contribuição (C13.4) — é só a tabela + a leitura. Ninguém tem como
-- ESCREVER `plano = 'plus'` ainda (nenhum código do backend faz INSERT/UPDATE
-- nesta tabela até C13.3/C13.4 chegarem). Todo mundo lê `gratis`.
--
-- DUAS REGRAS TRAVADAS QUE ISTO NÃO PODE VIOLAR (docs/21, docs/CLAUDE.md):
--   1. O plano nunca influencia o que ENTRA no pool — escanear cupom é
--      ilimitado nos dois planos, para sempre. Esta tabela não tem relação
--      nenhuma com `observacao_preco`, `cupom` ou `item_cupom`.
--   2. O plano nunca influencia o VEREDITO — mediana/faixa típica são
--      idênticas nos dois planos (muro da neutralidade, decisão travada #8).
--      `assinatura` só decide profundidade/conveniência de exibição no app
--      (ver `Recurso` em direitos.ts), nunca o número mostrado na gôndola.
--
-- =====================================================================
-- Tabela: um plano por usuário. PRIVADO (mesma categoria de `cupom`), nunca
-- cruza para o pool anônimo.
-- =====================================================================
create table if not exists public.assinatura (
  usuario_id    uuid primary key references public.usuario (id) on delete cascade,
  plano         text not null default 'gratis' check (plano in ('gratis', 'plus')),
  -- Como a pessoa chegou ao 'plus': contribuição (C13.4, plus_contribuindo) ou
  -- pagamento (C13.3, Google Play Billing). Null só é válido com plano='gratis'
  -- (ver constraint abaixo) — 'plus' sem origem seria um plano pago sem
  -- explicação de como foi concedido, o tipo de estado que não se audita depois.
  origem        text check (origem in ('contribuicao', 'pago')),
  -- Validade do 'plus'. Null = sem validade (plano 'gratis', ou 'plus'
  -- vitalício — ex. um plus_contribuindo renovado que nunca expira enquanto a
  -- contribuição continuar). O SERVIÇO (não o banco) trata `valido_ate` no
  -- passado como 'gratis' na leitura — ver `ServicoAssinatura.obterEstado`.
  valido_ate    timestamptz,
  criado_em     timestamptz not null default now(),
  -- Sem trigger de atualização automática: ainda não há nenhum ESCRITOR desta
  -- coluna (chega em C13.3/C13.4). A coluna existe com o default para não
  -- exigir outra migração quando o primeiro escritor nascer.
  atualizado_em timestamptz not null default now(),
  constraint assinatura_origem_consistente check (
    (plano = 'gratis' and origem is null) or
    (plano = 'plus' and origem is not null)
  )
);

comment on table public.assinatura is
  'C13.2 — Estado do plano por usuário (PRIVADO). Quem não tem linha aqui é '
  '''gratis'' por padrão (nunca o contrário). Não influencia o pool nem o '
  'veredito (docs/21, regras travadas #1 e #2) — só profundidade/conveniência '
  'de exibição no app (Recurso, shared/src/plano/direitos.ts).';
comment on column public.assinatura.origem is
  'Como o ''plus'' foi concedido: contribuicao (C13.4) ou pago (C13.3). '
  'Null só é válido com plano=''gratis'' — ver assinatura_origem_consistente.';
comment on column public.assinatura.valido_ate is
  'Null = sem validade (gratis, ou plus vitalício). O backend NUNCA confia num '
  '''plus'' com valido_ate no passado — a leitura trata como gratis mesmo que '
  'o job de revogação (C13.3/C13.4) ainda não tenha limpado a linha.';

-- =====================================================================
-- RLS: SELECT do dono, e SÓ ISSO — sem política de INSERT/UPDATE/DELETE.
--
-- Isto é DIFERENTE de `alerta_preco`/`dispositivo_push` (20260801130000), que
-- usam `for all` (o dono pode ler E escrever o próprio alerta). Aqui a escrita
-- fica reservada exclusivamente à service role do backend (que ignora RLS de
-- qualquer forma) — nenhuma política de escrita é criada, nem para o dono.
--
-- POR QUÊ: um alerta forjado por um usuário mal-intencionado (via PostgREST
-- direto, se os grants de `authenticated` algum dia voltarem por engano — ver
-- 20260724090000_revoga_grants_anon.sql) é inofensivo — na pior hipótese ele
-- mesmo recebe um push a mais. Uma ASSINATURA forjada tem valor: se existisse
-- uma política `for all` (ou até só de UPDATE) com `using (auth.uid() =
-- usuario_id)`, qualquer usuário autenticado poderia fazer
-- `PATCH /assinatura?usuario_id=eq.<eu>` e se autoconceder `plano = 'plus'`
-- direto pelo PostgREST, sem passar pelo backend nem por nenhuma verificação
-- de pagamento/contribuição. Por isso: zero política de escrita aqui, ligado
-- ou não o event trigger de RLS automático — defesa em profundidade contra
-- justamente o cenário em que a primeira camada (grants revogados) falhar.
-- =====================================================================
alter table public.assinatura enable row level security;

drop policy if exists assinatura_proprio_select on public.assinatura;
create policy assinatura_proprio_select on public.assinatura
  for select using ((select auth.uid()) = usuario_id);
