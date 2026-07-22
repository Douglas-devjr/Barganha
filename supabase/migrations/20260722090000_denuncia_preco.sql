-- C12.5 — Denúncia de preço incorreto (sinal de curadoria).
--
-- A pessoa vê o TÍPICO da região (a mediana) e discorda: o preço não bate com a
-- gôndola, o produto casado é outro, a unidade está errada. Isso é sinal de que
-- a estatística de um `produto_canonico` num recorte geográfico está distorcida.
--
-- LGPD (docs/04, decisão travada #3) — o desenho evita a ligação proibida:
--
--  • A denúncia NÃO aponta para uma linha de `observacao_preco`. O alvo é o
--    PRODUTO + o recorte GEO (município/UF), que é o que a tela mostra. Assim não
--    existe nenhum ponteiro de um usuário para uma linha do pool anônimo — a
--    ligação que a decisão #3 proíbe simplesmente não tem onde nascer.
--  • `usuario_id` fica SÓ aqui (privado), para barrar reincidente e limitar spam.
--    Nunca cruza para o pool, e a fila de curadoria não o expõe.
--  • Denunciar NÃO escreve no pool. É só um sinal: o curador olha a fila e, se
--    houver distorção, corrige com as ferramentas que já existem (casamento,
--    unidade, alias). O gate de anonimização segue sendo o único caminho de
--    escrita em `observacao_preco`.
--
-- Depende de: dominio_tabelas (usuario, produto_canonico),
--             lancamento_manual_moderacao (enum `status_moderacao`).

-- Motivos do handoff 3a. Espelha o enum TS `MOTIVOS_DENUNCIA` (shared/enums).
create type motivo_denuncia as enum (
  'preco_divergente',   -- não confere com a gôndola
  'produto_errado',     -- casou com outro produto de nome parecido
  'unidade_errada',     -- unidade/quantidade equivocada
  'outro'
);

create table denuncia_preco (
  id                  uuid primary key default gen_random_uuid(),
  -- PRIVADO: quem denunciou (anti-abuso). Nunca vai ao pool nem à fila.
  usuario_id          uuid not null references usuario (id) on delete cascade,
  -- ALVO: o produto e o recorte geográfico — nunca uma observação específica.
  produto_canonico_id uuid not null references produto_canonico (id) on delete cascade,
  municipio           text,
  uf                  char(2),
  motivo              motivo_denuncia not null,
  -- Texto livre opcional (motivo "outro"). Sem dado pessoal: a UI não pede.
  comentario          text,
  status              status_moderacao not null default 'pendente',
  -- Anotação da curadoria ao decidir (auditoria).
  resolucao           text,
  criado_em           timestamptz not null default now(),
  decidido_em         timestamptz
);
comment on table denuncia_preco is
  'C12.5 — Denúncia de preço (PRIVADA, com usuario_id p/ anti-abuso). Aponta para produto+geo, NUNCA para observacao_preco: não publica nada, é sinal de curadoria.';
comment on column denuncia_preco.usuario_id is
  'PRIVADO — anti-abuso. Não é exposto na fila de curadoria e nunca cruza para o pool (docs/04).';
comment on column denuncia_preco.produto_canonico_id is
  'Alvo da denúncia. O recorte é produto+geo (o que a tela mostra), não uma linha do pool — evita ligar usuário a observação anônima.';

-- Fila de curadoria: os pendentes, mais antigos primeiro.
create index denuncia_preco_fila_idx
  on denuncia_preco (status, criado_em)
  where status = 'pendente';

-- Agrupamento por alvo: quantas denúncias abertas um produto acumula.
create index denuncia_preco_alvo_idx
  on denuncia_preco (produto_canonico_id, status);

-- Anti-spam: a mesma pessoa não empilha denúncias abertas do mesmo produto.
-- Parcial (só `pendente`) para não impedir uma nova denúncia depois de resolvida.
create unique index denuncia_preco_unica_pendente_idx
  on denuncia_preco (usuario_id, produto_canonico_id)
  where status = 'pendente';

-- RLS explícito. O backend fala pela SERVICE ROLE (ignora RLS); ligar sem
-- política NEGA tudo para anon/authenticated. Sem esta linha, um `db reset`
-- recriaria a tabela sem RLS e a anon key leria `usuario_id` — a ligação que o
-- desenho inteiro existe para evitar (ver 20260629130000_seguranca_rls_search_path).
alter table public.denuncia_preco enable row level security;
