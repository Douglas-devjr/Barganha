/**
 * C5.3 — Migrações do SQLite local, aplicadas incrementalmente via
 * `PRAGMA user_version`. Cada item é um degrau idempotente por posição: o índice
 * no array é a versão. Nunca edite uma migração já publicada — adicione outra.
 *
 * O esquema espelha o lado PRIVADO (docs/04) + o cache de estatísticas e a fila
 * de upload (docs/05). Datas como TEXT ISO 8601; números monetários como REAL.
 */

export const MIGRACOES: string[] = [
  // v1 — esquema inicial do app (C5.3).
  `
  CREATE TABLE cupom_local (
    id                  TEXT PRIMARY KEY NOT NULL,
    cupom_id_servidor   TEXT,
    qr_payload          TEXT NOT NULL,
    chave_acesso        TEXT,
    capturado_em        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'qr_capturado',
    loja_cnpj           TEXT,
    loja_nome           TEXT,
    emitido_em          TEXT,
    uf                  TEXT,
    criado_em           TEXT NOT NULL,
    atualizado_em       TEXT NOT NULL
  );

  -- Idempotência local: não duplicar uma nota já capturada (quando a chave é
  -- conhecida). A chave definitiva de idempotência é do backend (docs/05).
  CREATE UNIQUE INDEX cupom_local_chave_uniq
    ON cupom_local (chave_acesso) WHERE chave_acesso IS NOT NULL;
  CREATE INDEX cupom_local_status_idx ON cupom_local (status);

  CREATE TABLE item_cupom_local (
    id                  TEXT PRIMARY KEY NOT NULL,
    cupom_local_id      TEXT NOT NULL REFERENCES cupom_local (id) ON DELETE CASCADE,
    produto_canonico_id TEXT,
    descricao_original  TEXT NOT NULL,
    ean                 TEXT,
    quantidade          REAL NOT NULL,
    unidade             TEXT NOT NULL,
    valor_unitario      REAL NOT NULL,
    valor_total         REAL NOT NULL,
    desconto            REAL
  );
  CREATE INDEX item_cupom_local_cupom_idx ON item_cupom_local (cupom_local_id);
  CREATE INDEX item_cupom_local_canonico_idx ON item_cupom_local (produto_canonico_id);

  -- Cache do pool COMPARTILHADO (anônimo) — só leitura derivada do servidor.
  CREATE TABLE cache_estatistica (
    produto_canonico_id TEXT NOT NULL,
    escopo              TEXT NOT NULL,
    escopo_id           TEXT NOT NULL,
    unidade_base        TEXT NOT NULL,
    mediana             REAL,
    p25                 REAL,
    p75                 REAL,
    minimo              REAL,
    maximo              REAL,
    menor_promocional   REAL,
    n_observacoes       INTEGER NOT NULL DEFAULT 0,
    atualizado_em       TEXT NOT NULL,
    PRIMARY KEY (produto_canonico_id, escopo, escopo_id, unidade_base)
  );
  CREATE INDEX cache_estatistica_produto_idx ON cache_estatistica (produto_canonico_id);

  -- Fila de upload de QRs pendentes (C6.2). Estado de retry/backoff.
  CREATE TABLE fila_upload (
    cupom_local_id       TEXT PRIMARY KEY NOT NULL REFERENCES cupom_local (id) ON DELETE CASCADE,
    tentativas           INTEGER NOT NULL DEFAULT 0,
    ultima_tentativa_em  TEXT,
    proxima_tentativa_em TEXT,
    ultimo_erro          TEXT,
    criado_em            TEXT NOT NULL
  );

  -- Metadados chave/valor: cursor de delta sync, id da conta anônima, etc.
  CREATE TABLE meta_sync (
    chave TEXT PRIMARY KEY NOT NULL,
    valor TEXT
  );
  `,
];
