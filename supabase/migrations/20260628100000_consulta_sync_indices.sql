-- Camada 4 (C4) — Índices de suporte à API de consulta e ao delta sync.
-- Não cria tabelas (preco_estatistica nasceu em C1.2); só acelera os caminhos de
-- leitura que a Camada 4 introduz. Afinação fina (EXPLAIN/ANALYZE) fica em C9.3.

-- Delta sync por REGIÃO (C4.2): "o que mudou (atualizado_em) nestes escopo_id".
-- O escopo_id lidera (filtro por município/UF); atualizado_em fecha o recorte do
-- cursor e já entrega as linhas ordenadas.
create index if not exists preco_estatistica_escopo_atualizado_idx
  on preco_estatistica (escopo_id, atualizado_em);

-- Delta sync por PRODUTO (C4.2): "o que mudou nos produtos do meu histórico".
create index if not exists preco_estatistica_produto_atualizado_idx
  on preco_estatistica (produto_canonico_id, atualizado_em);

-- Consulta por nome (C4.1): pré-filtro por substring da descrição normalizada
-- (ilike '%token%'). pg_trgm acelera o LIKE com padrão de início variável; busca
-- de texto plena (tsvector/ranking) é evolução de C9.3.
create extension if not exists pg_trgm;
create index if not exists produto_canonico_descricao_trgm_idx
  on produto_canonico using gin (descricao_normalizada gin_trgm_ops);
