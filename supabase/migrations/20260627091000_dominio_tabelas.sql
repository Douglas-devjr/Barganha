-- Camada 1 (C1.2) — Tabelas do domínio v1.
-- Cria os DOIS mundos de dados, estritamente separados (docs/04-privacidade-lgpd.md):
--   • PRIVADO       : usuario, cupom, item_cupom — histórico do usuário; contém
--                     chave_acesso e usuario_id; NUNCA vai ao pool.
--   • COMPARTILHADO : loja, produto_canonico, produto_alias, observacao_preco,
--                     preco_estatistica — anônimo de nascença; sem usuario_id,
--                     sem chave_acesso, itens "soltos".
-- Depende da baseline (extensão pgcrypto + enums status_cupom e escopo_geo).

-- =====================================================================
-- LADO COMPARTILHADO (anônimo) — criado primeiro: é alvo de FKs do privado.
-- =====================================================================

-- loja — derivada do CNPJ; é a chave da geolocalização (geo pela LOJA, nunca
-- rastreando o usuário). Município é a unidade geo principal.
create table loja (
  cnpj          text primary key,
  razao_social  text,
  nome_fantasia text,
  rede          text,
  endereco      text,
  municipio     text,
  uf            char(2),
  lat           numeric,
  long          numeric,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table loja is 'Estabelecimento (compartilhado). Geo derivada do CNPJ — nunca do GPS do usuário.';

-- produto_canonico — a referência única de um produto para comparação.
-- unidade_base é a base de comparação (nunca comparar valor cru).
create table produto_canonico (
  id                    uuid primary key default gen_random_uuid(),
  ean                   text,
  descricao_normalizada text,
  marca                 text,
  categoria             text,
  unidade_base          text not null check (unidade_base in ('kg', 'L', 'un')),
  imagem_url            text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
comment on table produto_canonico is 'Produto de referência (compartilhado). unidade_base = base de comparação R$/kg|L|un.';

-- EAN é único quando existe (itens sem código de barras casam por texto).
create unique index produto_canonico_ean_uniq
  on produto_canonico (ean)
  where ean is not null;

-- produto_alias — casa descrições variadas (sem EAN / variações de texto) ao
-- canônico. Vira referência só quando confirmado (curadoria/usuário). Ver docs/06.
create table produto_alias (
  id                  uuid primary key default gen_random_uuid(),
  produto_canonico_id uuid not null references produto_canonico (id) on delete cascade,
  texto_original      text not null,
  confianca           numeric,
  confirmado          boolean not null default false,
  criado_em           timestamptz not null default now()
);
comment on table produto_alias is 'Mapeia descrições de cupom → produto_canonico (casamento por texto, com confirmação).';

create index produto_alias_canonico_idx on produto_alias (produto_canonico_id);

-- observacao_preco — O CORAÇÃO ANÔNIMO. Cada linha é uma observação SOLTA:
-- sem usuario_id, sem cupom_id, sem chave_acesso. Não há como religar à cesta.
-- A ausência física dessas colunas é a garantia arquitetural (docs/04).
-- Escrita EXCLUSIVAMENTE pela camada de anonimização do backend (C2.4),
-- a partir do gate único definido em shared/ (C1.4).
create table observacao_preco (
  id                  uuid primary key default gen_random_uuid(),
  produto_canonico_id uuid not null references produto_canonico (id),
  loja_cnpj           text not null references loja (cnpj),
  municipio           text,
  uf                  char(2),
  preco_normalizado   numeric not null,
  unidade_base        text not null check (unidade_base in ('kg', 'L', 'un')),
  em_promocao         boolean not null default false,
  observado_em        timestamptz not null,
  criado_em           timestamptz not null default now()
);
comment on table observacao_preco is 'Observação de preço ANÔNIMA e SOLTA. Sem usuario_id/cupom_id/chave_acesso (LGPD).';

-- Consulta geo principal: por produto + recorte geográfico.
create index observacao_preco_geo_idx
  on observacao_preco (produto_canonico_id, uf, municipio);
-- Decaimento temporal / janelas de tempo (ver docs/06).
create index observacao_preco_observado_idx
  on observacao_preco (observado_em);

-- preco_estatistica — agregação por produto × escopo geográfico (cache de
-- consulta e o que o app baixa via delta sync). Veredito usa mediana/percentis,
-- nunca média; promoção fica à parte em menor_promocional (docs/06).
create table preco_estatistica (
  produto_canonico_id uuid not null references produto_canonico (id) on delete cascade,
  escopo              escopo_geo not null,
  escopo_id           text not null,
  unidade_base        text not null check (unidade_base in ('kg', 'L', 'un')),
  mediana             numeric,
  p25                 numeric,
  p75                 numeric,
  minimo              numeric,
  maximo              numeric,
  menor_promocional   numeric,
  n_observacoes       integer not null default 0,
  atualizado_em       timestamptz not null default now(),
  primary key (produto_canonico_id, escopo, escopo_id, unidade_base)
);
comment on table preco_estatistica is 'Faixas por produto×escopo (mediana/p25/p75/mín/máx). Fonte do cache e do delta sync.';

-- Cursor do delta sync: baixar só o que mudou desde atualizado_em (docs/05).
create index preco_estatistica_atualizado_idx
  on preco_estatistica (atualizado_em);

-- =====================================================================
-- LADO PRIVADO — histórico do usuário. Contém identificadores; nunca cruza
-- para o pool compartilhado.
-- =====================================================================

-- usuario — mínimo possível. Sem nome, sem CPF. Auth mínima entra em C4.3
-- (avaliar conta anônima); por ora só o id e a data de criação.
create table usuario (
  id        uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now()
);
comment on table usuario is 'Conta (privado). Sem nome/CPF — minimização LGPD. Auth real em C4.3.';

-- cupom — a nota do usuário. chave_acesso e qr_payload são PRIVADOS.
-- loja_cnpj/emitido_em/uf ficam nulos até o parsing concluir (status).
create table cupom (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuario (id) on delete cascade,
  chave_acesso  text,
  loja_cnpj     text references loja (cnpj),
  emitido_em    timestamptz,
  uf            char(2),
  status        status_cupom not null default 'qr_capturado',
  qr_payload    text not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table cupom is 'Nota do usuário (PRIVADO). chave_acesso/qr_payload nunca vão ao pool compartilhado.';

-- Idempotência do upload: uma nota por usuário (não duplicar QR já enviado).
create unique index cupom_usuario_chave_uniq
  on cupom (usuario_id, chave_acesso)
  where chave_acesso is not null;

create index cupom_usuario_idx on cupom (usuario_id);

-- item_cupom — itens da nota do usuário (PRIVADO). produto_canonico_id fica
-- nulo até o casamento (EAN direto ou texto confirmado).
create table item_cupom (
  id                  uuid primary key default gen_random_uuid(),
  cupom_id            uuid not null references cupom (id) on delete cascade,
  produto_canonico_id uuid references produto_canonico (id),
  descricao_original  text not null,
  ean                 text,
  quantidade          numeric not null,
  unidade             text not null,
  valor_unitario      numeric not null,
  valor_total         numeric not null,
  desconto            numeric,
  criado_em           timestamptz not null default now()
);
comment on table item_cupom is 'Item da nota do usuário (PRIVADO). Origem da observacao_preco anônima via gate.';

create index item_cupom_cupom_idx on item_cupom (cupom_id);
create index item_cupom_canonico_idx on item_cupom (produto_canonico_id);
