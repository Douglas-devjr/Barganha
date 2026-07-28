# 19 — Ambientes (dev × produção) e endurecimento operacional

Este documento cobre o que **não é código** e por isso não pode ser resolvido por
uma alteração no repositório: configuração de projeto no Supabase, variáveis de
build no EAS e segredos de CI. Cada passo aqui é executado uma vez, à mão.

---

## 0. Os projetos, para não confundir

| ref | nome | papel |
|---|---|---|
| `hyscmtnptevhkmrwarey` | Barganha | **PRODUÇÃO** |
| `luiepqctfmluczywbizt` | Barganha-dev | **DESENVOLVIMENTO** (criado em 24/07/2026) |

Os dois vivem na mesma conta/organização (`pohtaxdcwftzduiwlxmr`), então o mesmo
`SUPABASE_ACCESS_TOKEN` alcança ambos — não é preciso trocar de login.

O projeto `oogvlkihjzyjxsrokria` que aparece se você listar com outra conta
(`arkasher21@gmail.com`) **não tem relação com o Barganha**.

---

## 1. Separar o Supabase de desenvolvimento do de produção

> **Status: concluído em 24/07/2026.** O passo a passo fica registrado para
> reprodução (e para o dia em que existir um ambiente de staging).

**O problema.** Hoje existe um único projeto Supabase. Desenvolvimento e produção
compartilham o mesmo banco — e, principalmente, o mesmo `observacao_preco`. Cada
cupom de teste escaneado durante o desenvolvimento entra no pool colaborativo e
desloca a mediana que os usuários reais veem. Isso viola na prática a promessa do
veredito: a faixa típica passa a conter dados que não são observações reais de
mercado.

**Passo a passo.**

1. No dashboard do Supabase, crie um segundo projeto — sugestão de nome:
   `barganha-dev`. Free tier. O projeto atual passa a ser **produção**.
2. Aplique o esquema no projeto novo:
   ```bash
   supabase link --project-ref <ref-do-projeto-dev>
   supabase db push
   ```
3. Aponte o **desenvolvimento** para o projeto novo, em `.env` (backend) e
   `app/.env` (app):
   ```
   SUPABASE_URL=https://<ref-dev>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service role do dev>
   EXPO_PUBLIC_SUPABASE_URL=https://<ref-dev>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key do dev>
   ```
4. Os segredos do GitHub Actions (`SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`) e do Render continuam apontando para
   **produção** — é lá que os jobs de recálculo e alerta devem rodar.
5. Depois de trocar, limpe o pool de produção do que entrou em teste. Sem
   `usuario_id` na tabela não dá para filtrar por autor — filtre pelo CNPJ das
   lojas usadas em teste, ou, se o volume real ainda for pequeno, esvazie e deixe
   o pool reconstruir:
   ```sql
   -- Confira o que vai sair ANTES de apagar.
   select loja_cnpj, count(*) from observacao_preco group by 1 order by 2 desc;
   ```
   Recalcule as estatísticas em seguida (`npm run job:recalculo -w @barganha/backend`
   com `RECALCULO_LOOKBACK_MINUTES=0`).

---

## 2. Variáveis do Supabase nos builds do EAS

**O problema.** `app/eas.json` define `EXPO_PUBLIC_API_URL` para os perfis
`preview` e `production`, mas **não** define `EXPO_PUBLIC_SUPABASE_URL` nem
`EXPO_PUBLIC_SUPABASE_ANON_KEY`. Como `app/.env` é ignorado pelo git e
`eas.json` usa `requireCommit: true`, um build só recebe essas variáveis se elas
estiverem cadastradas como *EAS Environment Variables*. Se não estiverem, o app
lança `Supabase não configurado` já no boot.

**Passo a passo.**

```bash
# Produção
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref-prod>.supabase.co"
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key de produção>"

# Preview (staging)
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref-dev>.supabase.co"
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key de dev>"
```

Confira com `eas env:list`. A anon key é pública por desenho (ela vive dentro do
APK), mas mesmo assim não a comite: o que protege o banco é o RLS, e manter a
chave fora do repositório evita que ela circule por engano.

Para validar antes de publicar:

```bash
eas build --profile preview --platform android
```

---

## 3. Fechar o acesso direto ao banco pela anon key

**O problema.** O projeto Supabase expõe o PostgREST em
`https://<ref>.supabase.co/rest/v1`. A anon key está dentro do app e pode ser
extraída do APK em minutos. Até a migração `20260724090000`, o que impedia
alguém de baixar o pool inteiro por ali era **apenas o RLS**: os papéis `anon` e
`authenticated` tinham GRANT em todas as 13 tabelas de `public`. Defesa em
profundidade quer duas camadas independentes; havia uma.

> **Não faça o caminho "óbvio".** A versão anterior deste documento mandava
> remover `public` de *Settings → API → Exposed schemas*. **Isso derruba o
> backend inteiro.** Ele fala com o banco pelo próprio PostgREST — `supabase-js`
> com a service role (`backend/src/persistencia/supabase.ts`), 11 chamadas
> `.from()`/`.rpc()` no repositório. Não existe driver Postgres direto no
> projeto, e `DATABASE_URL` não é lido em runtime. Desexpor `public` mataria
> ingestão, consulta e sync junto com o atacante.

**A solução correta** é fechar na camada de PRIVILÉGIO, não de exposição — e ela
já está versionada em `supabase/migrations/20260724090000_revoga_grants_anon.sql`.
Revoga os grants de `anon`/`authenticated` em `public` (inclusive os default
privileges, para tabela nova não renascer aberta) e mantém `service_role`
intacto. O RLS continua como segunda camada.

Não há passo manual no dashboard: aplique com `supabase db push`.

**Validação** (feita no dev em 24/07/2026):

```bash
# service_role — o backend precisa disto → responde a lista (vazia)
curl "https://<ref>.supabase.co/rest/v1/observacao_preco?select=id&limit=1" \
  -H "apikey: <service_role>" -H "Authorization: Bearer <service_role>"

# anon → 42501 "permission denied for table observacao_preco"
curl "https://<ref>.supabase.co/rest/v1/observacao_preco?select=id&limit=1" \
  -H "apikey: <anon>"

# Auth continua intacto (o app usa a anon key para login/cadastro)
curl -X POST "https://<ref>.supabase.co/auth/v1/signup" -H "apikey: <anon>" \
  -H "Content-Type: application/json" \
  -d '{"email":"...","password":"...","data":{"nome":"Teste"}}'
```

O GoTrue vive no schema `auth` e não é afetado: login, cadastro, refresh e OAuth
seguem funcionando, assim como o trigger `handle_new_user` que provisiona a linha
em `public.usuario`. O SQL Editor do Studio também segue normal.

Reversível: `grant all on all tables in schema public to anon, authenticated;`

---

## 4. Webhook do alerta de parsing

O job `alerta-parsing` (cron horário, `.github/workflows/alerta-parsing.yml`)
avalia a taxa de falha por UF e avisa quando um portal degrada. Sem webhook ele
apenas registra a linha `error` no log da execução — útil, mas ninguém é
notificado.

1. Crie um webhook no Discord (Configurações do canal → Integrações → Webhooks)
   ou no Slack (Incoming Webhooks).
2. GitHub → Settings → Secrets and variables → Actions → **New repository
   secret**: `ALERTA_WEBHOOK_URL` com a URL.
3. Dispare o workflow manualmente (`workflow_dispatch`) para conferir o caminho
   ponta a ponta.

Limiares em `backend/src/observabilidade/alerta-parsing.ts`: 30% de falha com no
mínimo 20 tentativas na UF. Ajuste com dados reais — o objetivo é nunca disparar
por oscilação normal do reCAPTCHA do RJ, e sempre disparar quando um parser
quebra de vez.

---

## 5. Links de e-mail de auth: confirmação e reset (deep link × página-ponte)

**O problema.** Os e-mails de auth (confirmar cadastro, recuperar senha) mandam o
usuário para o Supabase (`/auth/v1/verify?...&redirect_to=barganha://auth-callback`),
que faz um **redirect 302 automático** para o esquema do app,
`barganha://auth-callback?code=...` (o valor de `REDIRECT` em
`app/src/auth/contexto.ts`). No celular, o navegador **não entrega** um esquema
custom vindo de um redirect sem gesto do usuário: o Chrome trata `barganha://`
como endereço web, não acha o "site" e mostra **"Não é possível acessar esse
site"**. Resultado observado: o usuário confirma o e-mail achando que confirmou,
mas o link nunca chega ao app — e o login por senha responde com
`Invalid login credentials` (o GoTrue recente usa a mesma mensagem para
credencial errada **e** para e-mail não confirmado), o que se traduz na UI como
"Email ou senha incorretos" e manda o diagnóstico para o lado errado.

O app **já sabe** receber o deep link (`getInitialURL` + listener `url` →
`exchangeCodeForSession`, em `app/src/auth/contexto.tsx`). O que falta é o caminho
de ENTREGA do link até o app — e isso é config de ambiente, não código.

### 5a. A página-ponte (implementada) — mantém a confirmação de e-mail ligada

A solução que funciona **mantendo "Confirm email" LIGADO** (para testar o fluxo
real) já está no código:

- **`site/auth-callback.html`** — página HTTPS que recebe o `?code=` (o navegador
  a carrega sem problema), repassa TODOS os parâmetros para
  `barganha://auth-callback?...` e oferece um botão **"Abrir no Barganha"**. O
  toque é o gesto que os navegadores exigem para lançar o esquema; a tentativa
  automática é só um atalho. Também trata `error_description`/link expirado.
- **App** — os links de e-mail passam a apontar para essa página, não mais para o
  esquema custom: `emailRedirectTo` (cadastro) e `redirectTo` (reset) usam
  `REDIRECT_EMAIL = obterUrlCallbackEmail()` (`app/src/auth/config.ts`, default no
  GitHub Pages, sobrescrevível por `EXPO_PUBLIC_AUTH_EMAIL_REDIRECT`). O OAuth do
  Google continua no `barganha://` direto (`openAuthSessionAsync` intercepta o
  esquema), e a escuta do deep link em `contexto.tsx` já recebe o salto da ponte.

**Passo a passo para valer no dev (`barganha-dev`):**

1. **Publique o `site/` atualizado** para o repo público do GitHub Pages (o
   procedimento está em `site/README.md`), para que
   `https://douglas-devjr.github.io/barganha-legal/auth-callback.html` fique no ar.
2. **Authentication → URL Configuration → Redirect URLs:** adicione
   `https://douglas-devjr.github.io/barganha-legal/auth-callback.html` **e**
   mantenha `barganha://auth-callback` (usado pelo OAuth). Sem a URL na allow-list
   o Supabase ignora o `redirect_to` e cai na Site URL.
3. **Recarregue o Metro** no dev build (mudança é só de JS — não precisa rebuild
   nativo). O `scheme: "barganha"` já está no `app.json`; se ao tocar no botão o
   app não abrir, é porque o dev build instalado é anterior ao `scheme` — aí sim
   refaça o build.
4. Confirme quem já havia cadastrado antes desta correção na mão (Authentication →
   Users → "…" → **Confirm email**), já que o link antigo deles não chegou ao app.

### 5b. Endurecimento de produção (opcional, quando escalar)

A ponte com botão já é robusta. Dois refinamentos entram quando houver domínio
próprio, para o link abrir o app **sem o toque**:

- **Android App Links:** publicar `/.well-known/assetlinks.json` (SHA-256 da
  assinatura) e declarar o `intentFilter` com `autoVerify` no `app.json`
  (`android.intentFilters`) — hoje só há `scheme`.
- **iOS Universal Links:** publicar `/.well-known/apple-app-site-association` e
  declarar `associatedDomains` (`applinks:<dominio>`) no `app.json`.

Com App Links, a mesma `auth-callback.html` passa a abrir o app automaticamente; o
botão continua como fallback para quem não tem o app instalado.

---

## 6. O que fica para quando escalar (não fazer agora)

Dois pontos são conhecidos e **corretos como estão** enquanto o backend rodar em
uma única instância. Ambos passam a importar no dia em que houver duas:

- **Fila em memória** (`fila/fila-memoria.ts`). Um restart perde o que estava em
  processamento; hoje isso é coberto por `reprocessador.recuperarPendentes` no
  boot. Com duas instâncias, as duas processariam os mesmos cupons. Substituir
  por fila durável no Postgres (tabela de estado + polling, ou Supabase Queues).
- **Rate limit em memória** (`http/rate-limit.ts`). O teto vale por processo:
  com duas instâncias o limite efetivo dobra. A interface já foi desenhada para
  trocar o miolo por um store compartilhado (Redis/Postgres) sem tocar nas rotas.

Antecipar qualquer um dos dois hoje custa complexidade e não compra nada.

---

## 7. Hibernação do Render free (cold start)

O plano free hiberna a instância após ~15 min sem tráfego e o request seguinte
gasta 30–60s acordando o processo. Isso atravessava o app como falha inventada:
o cliente HTTP abortava em 15s fixos e a UI dizia "Sem conexão com o servidor"
para um servidor que estava apenas subindo. Duas defesas, independentes:

- **No app** — `app/src/api/politica-timeout.ts`. O teto deixou de ser fixo: 15s
  quando houve resposta nos últimos 5 min (instância comprovadamente acordada) ou
  quando a base é local (`http://` na LAN, onde não há hibernação); 60s no
  primeiro contato depois do silêncio. Qualquer resposta HTTP conta como prova de
  vida, inclusive 4xx. Como é JS puro, a correção viaja por `eas update`.
- **Na infra** — `.github/workflows/manter-api-acordada.yml`. `GET /saude` a cada
  10 min mantém a instância de pé; o repositório é público, então os minutos de
  Actions são gratuitos.

> **Cron só roda na branch padrão.** Um workflow agendado é lido da `main`: em
> branch de feature ele nunca dispara. Enquanto o merge não acontece, o cold
> start segue existindo — e é justamente por isso que a defesa do app não é
> redundante com o ping.

**Orçamento:** o free do Render dá 750 horas de instância por mês e um serviço
acordado 24/7 consome ~730. Cabe, mas não sobra para um segundo serviço free —
no dia em que existir um staging, este cron precisa ser reavaliado.

---

## 8. Cifrar as colunas privadas do Postgres (pendência **pré-beta**)

**O que fica em claro hoje:** `cupom.chave_acesso` e as descrições de
`item_cupom` — ambas amarradas ao `usuario_id`. Não são o dado mais sensível do
sistema (o CPF já não entra em lugar nenhum: os parsers não o extraem e o QR é
saneado ao concluir o cupom, docs/04), mas são o histórico de consumo de uma
pessoa identificável, e um dump vazado hoje é legível de ponta a ponta.

**Por que não foi feito junto com o resto do endurecimento de privacidade:**

- Toca o caminho crítico inteiro da ingestão — a RPC `processar_cupom`, o índice
  único `cupom_usuario_chave_uniq` (idempotência do upload) e o dedup por hash em
  `chave_publicada`. Feito antes do produto estabilizar, cada migração e cada
  consulta nova passa a carregar a criptografia junto.
- O ganho pré-lançamento é próximo de zero: a base está praticamente vazia.
- Errar a rotação da chave torna o histórico privado **irrecuperável**. Isso é
  disciplina operacional, e ela tem que existir antes da cifra.

**Desenho pretendido, para quando entrar:**

- **Envelope**, com a chave fora do banco (variável de ambiente do backend, nunca
  no repositório). Isso protege contra vazamento de *dump*; **não** protege
  contra invasão do servidor — e a diferença precisa estar clara para ninguém
  vender a cifra como garantia que ela não dá.
- **Idempotência preservada:** o índice único passa a ser sobre o
  **SHA-256** da chave de acesso (o `hashChavePool` já faz exatamente isso para o
  pool); o valor cifrado vive numa coluna à parte, que ninguém consulta por
  igualdade.
- **A chave de acesso precisa continuar reversível** — o reprocessamento
  retroativo (C2.5) consulta a SEFAZ a partir dela. Não pode virar só hash.
- **Rotação escrita antes da primeira cifra:** procedimento, onde a chave antiga
  fica durante a rotação, e como reverter. Sem isso, não ligar.

**Gate:** entra na Fase 3 (gate do beta fechado, docs/15), junto com os demais
itens que só passam a valer quando houver usuário real com dado real.
