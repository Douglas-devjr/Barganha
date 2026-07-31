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
  // v2 — totais do cupom (C2.6). O layout ENCAT só traz o desconto AGREGADO; o
  // bruto é a soma dos itens. `valor_pago` = bruto − desconto (valor real pago).
  `
  ALTER TABLE cupom_local ADD COLUMN desconto_total REAL;
  ALTER TABLE cupom_local ADD COLUMN valor_pago REAL;
  `,
  // v3 — lista de compras (C12.1). Local-first: a lista vive só no aparelho;
  // a comparação por loja consulta o pool anônimo sob demanda. `quantidade` é
  // multiplicador da unidade-base do produto (padrão 1).
  `
  CREATE TABLE lista_compras (
    produto_canonico_id TEXT PRIMARY KEY NOT NULL,
    nome                TEXT NOT NULL,
    quantidade          REAL NOT NULL DEFAULT 1,
    criado_em           TEXT NOT NULL
  );
  `,
  // v4 — alertas de preço (C8.4). Alvo em R$/unidade-base do produto; a
  // checagem roda no aparelho contra o cache regional (sem push na v1).
  `
  CREATE TABLE alerta_preco (
    produto_canonico_id TEXT PRIMARY KEY NOT NULL,
    nome                TEXT NOT NULL,
    preco_alvo          REAL NOT NULL,
    criado_em           TEXT NOT NULL
  );
  `,
  // v5 — feed de notificações (redesign 3a). Os avisos hoje são recalculados a
  // cada foco do Início e somem; aqui viram EVENTOS persistidos com estado de
  // leitura, que é o que a tela de Notificações precisa.
  //
  // Privado por natureza (docs/04): vive só neste aparelho, como o alerta que o
  // origina — nada viaja para o servidor e nada encosta em `observacao_preco`.
  //
  // `chave_dedupe` é o que impede o feed de inundar: a checagem de alertas roda
  // toda vez que o app foca, então o mesmo evento reaparece direto. A chave
  // carrega o bucket de tempo do evento (dia p/ preço, mês p/ resumo, único p/
  // selo), e o INSERT é idempotente por ela.
  `
  CREATE TABLE notificacao (
    id                  TEXT PRIMARY KEY NOT NULL,
    tipo                TEXT NOT NULL,
    chave_dedupe        TEXT NOT NULL,
    titulo              TEXT NOT NULL,
    subtitulo           TEXT,
    -- alvo de navegação ao tocar no item (quando o evento é de um produto)
    produto_canonico_id TEXT,
    criado_em           TEXT NOT NULL,
    -- NULL = não lida (o ponto do handoff 3a)
    lida_em             TEXT
  );

  CREATE UNIQUE INDEX notificacao_dedupe_uniq ON notificacao (chave_dedupe);
  CREATE INDEX notificacao_criado_idx ON notificacao (criado_em DESC);
  CREATE INDEX notificacao_nao_lida_idx ON notificacao (lida_em) WHERE lida_em IS NULL;
  `,
  // v6 — "no carrinho" na lista de compras (handoff 3a). A caixa de seleção da
  // aba Lista marca o que o usuário já pegou na gôndola; persiste porque a
  // compra atravessa fechamentos do app (e o corredor tem sinal ruim).
  //
  // O preço da gôndola digitado ao lado NÃO fica aqui de propósito: é de uma ida
  // ao mercado, envelhece em horas e viraria um "típico" falso na próxima visita.
  `
  ALTER TABLE lista_compras ADD COLUMN marcado INTEGER NOT NULL DEFAULT 0;
  `,
  // v7 — snapshot do TÍPICO da região no momento da compra, por item.
  //
  // Espelha as colunas novas de `item_cupom` no backend. Aqui é só espelho: o
  // valor é calculado no servidor ANTES de o cupom entrar no pool (para a base
  // ser o típico de antes da própria compra) e desce pronto pelo DTO.
  //
  // Cupons já sincronizados ficam com NULL para sempre — a mediana daquela
  // semana não existe mais em lugar nenhum. É exatamente por isso que a coluna
  // entra agora, antes da tela que vai consumi-la (docs/06 §"Economia real").
  `
  ALTER TABLE item_cupom_local ADD COLUMN tipico_mediana REAL;
  ALTER TABLE item_cupom_local ADD COLUMN tipico_unidade_base TEXT;
  ALTER TABLE item_cupom_local ADD COLUMN tipico_escopo TEXT;
  ALTER TABLE item_cupom_local ADD COLUMN tipico_n_observacoes INTEGER;
  `,
  // v8 — município da LOJA no espelho do cupom. O backend já mandava o campo em
  // `loja.municipio` (DTO de cupom e de histórico); o app o descartava.
  //
  // É o que permite a região derivada do histórico chegar ao nível de MUNICÍPIO
  // — o principal da agregação (decisão travada nº4) — em vez de parar na UF,
  // que é só o degrau mais amplo do fallback (docs/06). Continua sendo geo da
  // LOJA, e o valor não sai deste aparelho.
  //
  // Cupons já espelhados ficam com NULL (o backfill vem no restore pós-login) e
  // seguem resolvendo por UF, exatamente como antes desta coluna.
  `
  ALTER TABLE cupom_local ADD COLUMN loja_municipio TEXT;
  `,
  // v9 — "não conta na comparação de mercados", por item da lista.
  //
  // Existe porque tirar um item do ranking e apagá-lo da lista de compras são
  // duas intenções diferentes. Quem tira o frango para ver como o ranking fica
  // sem ele NÃO quer perder o frango da compra de sábado. Antes desta coluna a
  // exclusão só vivia no estado da tela: bastava sair e voltar para o item (e o
  // mercado que ele trazia junto) reaparecer — o bug que originou isto.
  //
  // Fica na `lista_compras` de propósito, e não numa tabela à parte: a cesta
  // comparada É a lista, com um recorte. Duas listas separadas dariam vencedores
  // diferentes na aba Lista e na tela Comparar mercados para a mesma pessoa.
  `
  ALTER TABLE lista_compras ADD COLUMN fora_comparacao INTEGER NOT NULL DEFAULT 0;
  `,
  // v10 — idade do PREÇO no cache local, espelhando `preco_estatistica.
  // observado_em_max` do backend.
  //
  // `atualizado_em` já estava aqui, mas ele é o carimbo do RECÁLCULO no servidor:
  // uma varredura completa (deploy, recalibração do decaimento) reescreve tudo
  // com a data de hoje e o app passaria a jurar que todo típico é fresco. Esta
  // coluna é a data da observação mais recente que sustenta a mediana — o que a
  // Verificar precisa para dizer "típico de há 40 dias" em vez de calar.
  //
  // Nula até o próximo delta sync trazer a linha de novo; quem lê trata a
  // ausência como idade DESCONHECIDA (nunca como recente).
  `
  ALTER TABLE cache_estatistica ADD COLUMN observado_em_max TEXT;
  `,
  // v11 — cache do CATÁLOGO compartilhado (C4.5): nome/marca/categoria por
  // produto, baixados por `POST /sync/produtos`.
  //
  // O delta de estatística desce preço por `produto_canonico_id` e nada mais.
  // Resultado: o app sabia quanto custa um produto que ele não sabe nomear — e
  // caía na descrição crua do cupom ("ARR TP1 TIO J 5KG"), ou em nada, quando o
  // produto entrou pela lista vindo do catálogo regional (C7.6).
  //
  // Derivado do servidor e ANÔNIMO como o cache de estatística: é o lado
  // compartilhado (docs/04), não tem observação nem dono. Por isso NÃO é apagado
  // ao trocar de região — o nome do arroz não muda de cidade —, mas sai inteiro
  // em `redefinirAppLocal` (logout), junto com o resto do que veio da rede.
  //
  // `atualizado_em` é o carimbo do DOWNLOAD (não do servidor): é ele que diz
  // quando revalidar o resumo, para um produto enriquecido pela curadoria depois
  // do primeiro sync não ficar sem nome para sempre.
  `
  CREATE TABLE cache_produto (
    produto_canonico_id TEXT PRIMARY KEY NOT NULL,
    nome_exibicao       TEXT,
    marca               TEXT,
    categoria           TEXT,
    imagem_url          TEXT,
    unidade_base        TEXT NOT NULL,
    atualizado_em       TEXT NOT NULL
  );
  `,
];
