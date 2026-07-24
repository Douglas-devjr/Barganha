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

## 5. O que fica para quando escalar (não fazer agora)

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
