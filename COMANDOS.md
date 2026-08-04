# Comandos do dia a dia

Referência rápida dos comandos mais usados no Barganha. Para o passo a passo
completo de configurar o ambiente do zero, veja [`COMO-RODAR.md`](COMO-RODAR.md);
para o runbook de publicação, veja [`docs/13-lancamento-operacao.md`](docs/13-lancamento-operacao.md).

Monorepo com 3 workspaces npm: `shared/`, `backend/` e `app/`. Todo comando roda
a partir da **raiz** do repositório (`C:\Users\exten\Desktop\Comparai`).

---

## Painel do projeto

O [`painel/`](painel/README.md) mostra o status real de cada etapa (`C0`–`C13`),
o que cada função faz e os bloqueadores de publicação. É um `index.html`
**gerado** — não atualiza sozinho a menos que você rode um destes comandos:

```bash
npm run painel            # gera painel/index.html uma vez
npm run painel:observar   # regera sozinho a cada mudança em mapa.mjs, app/src,
                           # backend/src, shared/src, supabase/migrations, docs
                           # (deixe rodando num terminal enquanto trabalha)
npm run painel:abrir      # abre o painel no navegador
npm run painel:conferir   # só confere e falha (exit 1) se houver deriva — é o
                           # que o `npm run check` e o CI rodam
```

Ao mudar código, o item correspondente em [`painel/mapa.mjs`](painel/mapa.mjs)
precisa ser atualizado à mão (status, campo `falta`) — isso o gerador não
descobre sozinho.

---

## Rodar em modo desenvolvimento

Backend e app rodam em terminais separados.

```bash
npm run backend      # API Fastify com reload automático (dev)
npm start            # bundler do app (Expo/Metro) — delega ao workspace app/
```

`npm start` na raiz é o caminho certo; **não** rode `expo start` direto (quebra
em `AppEntry.js` fora do workspace). Equivalentes explícitos por workspace:

```bash
npm run -w @barganha/backend dev
npm run -w @barganha/app start
```

Banco local (opcional — dá pra usar o projeto Supabase na nuvem também):

```bash
npx supabase start   # sobe Postgres + Auth + Studio em Docker
npx supabase db reset  # aplica todas as migrations locais
```

Antes de subir qualquer coisa, confira que está tudo são:

```bash
npm run check         # format:check + lint + typecheck + testes + painel:conferir
```

---

## Atualizar o app publicado (OTA, sem passar pela loja)

Mudança **só de JS/regras** (não mexeu em módulo nativo) viaja por **EAS
Update**, sem nova revisão na Google Play/App Store:

```bash
cd app
eas update --branch production   # ou --branch preview / development
```

O backend continua sendo a fonte da verdade (parsers, estatística) — a maior
parte das correções nem precisa de OTA, só um deploy do backend.

## Atualizar as migrations do banco

```bash
npx supabase migration new <nome>   # cria um novo arquivo em supabase/migrations
npx supabase db push                # aplica as migrations pendentes no banco remoto
npx supabase migration list         # compara local x remoto (o que falta aplicar)
```

---

## Gerar um novo build (nativo)

Precisa de um build novo (não só OTA) quando muda dependência nativa,
permissão, ícone, versão etc. Perfis em [`app/eas.json`](app/eas.json):
`development`, `preview`, `production`.

```bash
cd app
eas build --platform android --profile development   # dev client, uso local
eas build --platform android --profile preview        # APK p/ QA / beta fechado
eas build --platform android --profile production --auto-submit   # loja (.aab)
```

`--auto-submit` já envia para a Google Play (track `internal` por padrão — ver
`submit.production` em `app/eas.json`). Sem ele, submeta depois com:

```bash
eas submit --platform android --latest
```

Publicação automática por CI: push de tag `v*` dispara
`.github/workflows/release.yml` (requer o segredo `EXPO_TOKEN`).

---

## Outros comandos úteis

```bash
npm test               # só os testes (vitest)
npm run typecheck      # tipos dos 3 workspaces
npm run lint            # eslint
npm run format           # prettier --write
npm run publicar:site    # publica site/ (política de privacidade etc.) no GitHub Pages
```
