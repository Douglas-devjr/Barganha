-- C11.5 — Enriquecimento de produto (curadoria): nome de EXIBIÇÃO amigável.
-- `descricao_normalizada` é técnica (sem acento, maiúsculas) e é a base do
-- CASAMENTO — não deve ser reescrita por humanos. `nome_exibicao` é separado:
-- o que a UI da gôndola mostra ("Açúcar Refinado União 1kg"), sem afetar o
-- casamento. `marca`, `categoria` e `imagem_url` já existem (dominio_tabelas).
alter table produto_canonico add column nome_exibicao text;
comment on column produto_canonico.nome_exibicao is
  'C11.5 — Nome amigável p/ a UI (curadoria). Separado de descricao_normalizada (técnica, base do casamento).';
