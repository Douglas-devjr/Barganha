-- C3 (revisão F1) — índice para o recálculo incremental do pipeline.
-- `listarProdutosComObservacoes(desde)` filtra por INSERÇÃO (criado_em), não por
-- emissão, para não perder cupons antigos enviados tarde (offline-first). Este
-- índice cobre esse recorte temporal do job de agregação.
create index if not exists observacao_preco_criado_idx
  on observacao_preco (criado_em);
