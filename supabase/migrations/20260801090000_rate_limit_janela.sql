-- C9.3.2 — Teto de requisições compartilhado (rate-limit distribuído).
--
-- Tabela de estado para o limitador de taxa, permitindo múltiplas instâncias
-- respeitarem o mesmo teto. Antes: em memória (valia por processo). Agora:
-- no Postgres (vale para toda a frota).
--
-- Padrão: janela fixa por chave (IP ou conta). A chave expira quando a
-- janela fecha (janela_ms). A tabela é auto-limpante: linhas old são
-- apagadas num hook `onRequest` antes de cada check.

CREATE TABLE IF NOT EXISTS rate_limit_janela (
  chave TEXT NOT NULL PRIMARY KEY,
  inicio BIGINT NOT NULL,
  contagem INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índice por tempo de criação para limpeza eficiente de linhas old.
-- A limpeza roda no máximo uma vez por janela (5 min / 1 min / conforme config).
CREATE INDEX IF NOT EXISTS idx_rate_limit_janela_criado_em
  ON rate_limit_janela (criado_em);

-- Nenhum RLS: é dado operacional puro, sem propriedade de usuário.
-- O banco public é de confiança interna.
