# Como rodar o Barganha (guia de teste)

Passo a passo para subir o **backend** + **banco (Supabase)** + **app** e testar o
fluxo completo: consentimento → login → escanear cupom → verificar preço na gôndola.

> Monorepo com 3 workspaces npm: `shared/` (tipos e regras travadas),
> `backend/` (API Fastify) e `app/` (Expo / React Native).

---

## 0. Pré-requisitos

| Ferramenta | Versão | Para quê |
|---|---|---|
| **Node.js** | ≥ 20 | backend, app, tooling |
| **npm** | ≥ 9 (vem com o Node 20) | workspaces |
| **Conta Supabase** | — | banco Postgres + Auth (login) |
| **Supabase CLI** (opcional) | recente | rodar o banco local e aplicar migrações |
| **Celular** com **Expo Go** ou um **dev build** | — | abrir o app |

O app usa **câmera (QR/código de barras)**, **SQLite** e **navegador de OAuth**.
A leitura de QR e o login com Google só funcionam 100% num **dev build**
(`expo-dev-client`, já incluso). O **Expo Go** serve para testar UI + login por
**email/senha**, mas não abre o fluxo de Google (precisa do esquema `barganha://`).

---

## 1. Instalar as dependências (uma vez, na raiz)

```bash
npm install
```

Isso instala os 3 workspaces de uma vez. **Não** rode `npm install` dentro de
`app/` ou `backend/` separadamente.

Confira que está tudo são antes de subir nada:

```bash
npm run check     # format:check + lint + typecheck + testes (227 testes)
```

---

## 2. Provisionar o Supabase (banco + Auth)

Você pode usar o **projeto na nuvem** (mais simples para testar no celular) ou o
**banco local** via CLI.

### Opção A — Projeto Supabase na nuvem (recomendado p/ testar no celular)

1. Crie um projeto em <https://supabase.com> (ou use o existente).
2. Em **Project Settings → API**, copie:
   - **Project URL** → `SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_URL`
   - **anon public** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ **só no backend**, nunca no app)
3. Aplique as migrações de `supabase/migrations/` (vincule e suba):
   ```bash
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase db push
   ```
4. Em **Authentication → URL Configuration**, cadastre o redirect do app:
   ```
   barganha://auth-callback
   ```
5. (Opcional) Em **Authentication → Providers**, para testar mais rápido,
   desligue **"Confirm email"** — assim o cadastro já entra logado sem confirmar
   o email. Para o **Google**, configure o provider Google.

### Opção B — Supabase local (CLI)

```bash
npx supabase start          # sobe Postgres + Auth + Studio em Docker
npx supabase db reset       # aplica todas as migrações de supabase/migrations
```

Pegue a URL e as chaves impressas no terminal (`API URL`, `anon key`,
`service_role key`). No celular físico, a URL local **não** será `localhost` —
use o IP da sua máquina (ver passo 4).

---

## 3. Subir o backend (API)

1. Crie o `.env` na **raiz** a partir do modelo:
   ```bash
   cp .env.example .env
   ```
2. Preencha **no mínimo**:
   ```env
   SUPABASE_URL=https://SEU-PROJETO.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
   PORT=3000
   UFS_HABILITADAS=RJ,SP
   ```
3. Rode em modo dev (reload automático):
   ```bash
   npm run -w @barganha/backend dev
   ```
4. Confira a saúde em outro terminal:
   ```bash
   curl http://localhost:3000/saude     # -> {"ok":true}
   ```

> Endpoints anônimos: `POST /consulta/preco`, `POST /sync/estatisticas`.
> Endpoints privados (exigem `Authorization: Bearer <JWT>`): `POST /ingestao/qr`,
> `DELETE /conta`. O JWT é o do login do Supabase (passo 5).

---

## 4. Configurar o app (Expo)

1. Crie o `app/.env` a partir do modelo:
   ```bash
   cp app/.env.example app/.env
   ```
2. Preencha:
   ```env
   # Em emulador/web pode ser localhost. Em CELULAR FÍSICO, use o IP da máquina
   # na sua rede (ex.: http://192.168.0.10:3000) — localhost no celular é o próprio celular.
   EXPO_PUBLIC_API_URL=http://192.168.0.10:3000

   EXPO_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key
   ```

> Descubra seu IP local: `ipconfig` (Windows) → "Endereço IPv4". O celular e o PC
> precisam estar na **mesma rede Wi-Fi**.

---

## 5. Rodar o app

### Caminho recomendado — dev build (QR + Google funcionando)

O app já tem `expo-dev-client` e perfis EAS prontos (`app/eas.json`).

**Build na nuvem (EAS):**
```bash
npm i -g eas-cli
eas login
eas build --profile development --platform android   # ou: ios
```
Instale o APK/app gerado no aparelho, depois inicie o bundler:
```bash
npm run -w @barganha/app start        # abre o Metro; leia o QR no dev build
```

**Build local (alternativa, exige Android Studio / Xcode):**
```bash
cd app
npx expo run:android     # ou: npx expo run:ios
```

### Caminho rápido — Expo Go (só UI + login email/senha)

```bash
npm run -w @barganha/app start
```
Leia o QR com o **Expo Go**. Funciona para navegar pelas telas e logar por
email/senha; **leitura de QR de cupom e login Google** podem não funcionar sem o
dev build.

---

## 6. Roteiro de teste (o que clicar)

1. **Onboarding / Consentimento (LGPD):** primeira abertura → aceitar para seguir.
2. **Login:** criar conta por **email/senha** (passo 2.5 acelera, sem confirmar
   email) ou entrar com **Google** (dev build).
3. **Início:** card de economia + atalhos "Escanear cupom" e "Verificar preço".
4. **Escanear cupom:** aponte para o **QR Code de uma NFC-e** real (RJ ou SP, as
   UFs habilitadas). O app envia o QR cru; o parsing roda no backend (fila
   assíncrona). Acompanhe o cupom virar "processado".
5. **Verificar preço (gôndola):** escaneie o **código de barras** ou escolha um
   produto do histórico, digite o preço da prateleira e veja o veredito
   **barato / na média / caro** (faixa típica) + a linha de **promoção** à parte.
6. **Produtos / Detalhe:** histórico e evolução do preço por produto.
7. **Perfil:** seus mercados, **Sair** e **Apagar conta** (direito ao apagamento).

---

## 7. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| App: "Supabase não configurado" | falta `app/.env` | preencha `EXPO_PUBLIC_SUPABASE_URL` e `..._ANON_KEY` e reinicie o Metro |
| App não fala com a API no celular | `EXPO_PUBLIC_API_URL=localhost` | troque pelo **IP da máquina**; mesma Wi-Fi; backend ouvindo em `0.0.0.0` (já é o padrão) |
| Backend: "Variáveis de ambiente ausentes" | falta `.env` na raiz | defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` |
| Login Google não abre | rodando no Expo Go ou redirect não cadastrado | use o **dev build** e cadastre `barganha://auth-callback` no Supabase |
| 401 ao escanear cupom | sessão expirada / sem login | entre de novo; o Bearer é o JWT do Supabase |
| Variáveis `EXPO_PUBLIC_*` não atualizam | Metro com cache | pare e rode `npx expo start -c` |

---

## 8. Comandos úteis

```bash
npm run check          # tudo: format + lint + typecheck + testes
npm test               # só os testes (vitest)
npm run typecheck      # tipos dos 3 workspaces
npm run -w @barganha/backend dev     # API com reload
npm run -w @barganha/app start       # bundler do app
```
