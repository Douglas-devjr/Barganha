# supabase/ — Banco de dados (Postgres) e migrations

Base de dados do backend. Usamos o **Supabase CLI** para rodar o Postgres
localmente e versionar o schema como **migrations SQL** (uma pasta, ordem por
nome de arquivo). Provisionar a nuvem (projeto Supabase de dev) depende da
conta do dono do produto — ver passo 4.

## Estrutura

```
supabase/
├── config.toml                       # config do CLI (portas/serviços locais)
├── seed.sql                          # dados de desenvolvimento (vazio por ora)
└── migrations/
    └── 20260627090000_baseline.sql   # extensões + enums (fundação)
```

> A baseline traz só extensões (`pgcrypto`) e os enums (`status_cupom`,
> `escopo_geo`). As **tabelas** (privado x compartilhado) entram na Camada 1
> (C1.2). A escrita em `observacao_preco` é sempre via camada de anonimização
> — ver `docs/04-privacidade-lgpd.md`.

## Pré-requisitos

- [Supabase CLI](https://supabase.com/docs/guides/cli) instalado.
- Docker (o CLI sobe o Postgres local em contêiner).

## Desenvolvimento local

```bash
supabase start                 # sobe Postgres + Studio (portas em config.toml)
supabase db reset              # recria o banco aplicando migrations + seed
supabase migration new <nome>  # cria um novo arquivo de migration
supabase stop                  # encerra os contêineres
```

A `DATABASE_URL` local padrão está em `.env.example`
(`postgresql://postgres:postgres@localhost:54322/postgres`).

## Provisionar a nuvem (dev) — feito pelo dono do projeto

1. Criar o projeto em <https://supabase.com> (região mais próxima do Brasil).
2. Copiar `SUPABASE_URL` / chaves (Project Settings → API) para o `.env`
   (a `SERVICE_ROLE_KEY` fica **só no backend**, nunca no app).
3. Vincular e publicar o schema:
   ```bash
   supabase link --project-ref <ref-do-projeto>
   supabase db push          # aplica as migrations no banco remoto
   ```

> Nenhum segredo é commitado: `.env` é ignorado pelo Git (ver `.gitignore`).
