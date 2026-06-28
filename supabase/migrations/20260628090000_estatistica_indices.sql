-- Camada 3 (C3) — Índices de suporte ao motor estatístico.
-- Não cria tabelas novas (preco_estatistica já nasceu em C1.2); apenas acelera
-- os caminhos de leitura que o pipeline e o casamento por texto introduzem.
-- Afinação fina (EXPLAIN/ANALYZE, escala) fica para C9.3.

-- Pipeline (C3.1): "todas as observações de um produto, com recorte temporal"
-- (janela do decaimento). O índice geo existente lidera por produto, mas não
-- ordena por tempo; este cobre produto × observado_em.
create index if not exists observacao_preco_produto_tempo_idx
  on observacao_preco (produto_canonico_id, observado_em);

-- Casamento por texto (C3.5): candidatos são filtrados pela unidade-base
-- (kg/L/un) para reduzir falso positivo antes de calcular similaridade.
create index if not exists produto_canonico_unidade_idx
  on produto_canonico (unidade_base);
