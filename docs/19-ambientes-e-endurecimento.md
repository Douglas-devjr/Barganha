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

## 6. Rodar com mais de uma instância

Eram dois os pontos que só valiam para UM processo. **A fila já foi resolvida**;
sobra o rate limit.

### 6.1 Fila de processamento — durável (feito)

A fila é a tabela **`fila_processamento`** (migração `20260729100000`), drenada
por `fila/fila-postgres.ts`. Três coisas que a fila em memória não dava:

- **Exclusividade entre instâncias.** `fila_reivindicar` entrega o lote com
  `for update skip locked`: cada tarefa vai para UM consumidor, quantas
  instâncias existirem. Antes, cada processo tinha a sua lista e as duas
  parseavam o mesmo cupom (duas idas ao portal da SEFAZ pelo mesmo cupom).
- **Sobrevive ao restart.** Tentativas e backoff são colunas
  (`tentativas`, `disponivel_em`), não estado de processo. Deploy no meio de um
  backoff não perde a tarefa.
- **Recupera o trabalho de quem morreu.** Quem reivindica abre uma *lease* de 5
  min (`reivindicado_em`); vencida, a tarefa volta à fila e outra instância a
  pega. É o caminho para instância morta em deploy/OOM/hibernação — antes isso
  dependia de `reprocessador.recuperarPendentes` rodar no boot.

O que **não** mudou: só há retry quando o worker lança (erro transitório); erro
permanente marca o cupom `falha` sem retry; tentativas esgotadas deixam o cupom
para o reprocessamento retroativo (C2.5).

**Ordem de deploy (importa):** aplicar a migração ANTES de subir o código —
sem as RPCs, nada é enfileirado. A sonda crítica `fila-esquema` em `/saude`
existe para isso: sem a migração, `/saude/pronto` responde 503 e o deploy é
reprovado (esquema fora de sincronia), em vez de o app ficar em "Processando"
para sempre. `FILA_DURAVEL=false` volta à fila em memória — só para uma
instância, e é assim que se roda o dev local antes do `db push`.

A tarefa reivindicada por uma instância que recebeu `SIGTERM` não espera a lease:
o encerramento ordenado (`index.ts`) desliga o poll antes de fechar o servidor.

### 6.2 Rate limit em memória (continua pendente)

`http/rate-limit.ts` conta por processo: com duas instâncias o limite efetivo
dobra. A interface já foi desenhada para trocar o miolo por um store
compartilhado (Redis/Postgres) sem tocar nas rotas. Antecipar hoje custa
complexidade e não compra nada — o teto dobrado é degradação suave, não furo.

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

## 8. Cifrar as colunas privadas do Postgres (código pronto — ativação é gate **pré-beta**)

**O que ficava em claro:** `cupom.chave_acesso` e as descrições de
`item_cupom` — ambas amarradas ao `usuario_id`. Não são o dado mais sensível do
sistema (o CPF já não entra em lugar nenhum: os parsers não o extraem e o QR é
saneado ao concluir o cupom, docs/04), mas são o histórico de consumo de uma
pessoa identificável, e um dump vazado era legível de ponta a ponta.

**Status: código, migração e testes implementados (C9.2.2/b6).** O que falta é
só o passo MANUAL de ativação em produção — gerar a chave e configurá-la no
Render/GitHub Actions —, descrito no procedimento de rotação abaixo. Enquanto
esse passo não acontece, a cifra existe no código e no schema mas não está
"ligada de verdade": ver "Como isto convive com 'não ligar em produção ainda'"
mais abaixo.

**Por que não foi feito junto com o resto do endurecimento de privacidade,
originalmente:**

- Toca o caminho crítico inteiro da ingestão — a RPC `processar_cupom`, o índice
  único `cupom_usuario_chave_uniq` (idempotência do upload) e o dedup por hash em
  `chave_publicada`. Feito antes do produto estabilizar, cada migração e cada
  consulta nova passava a carregar a criptografia junto.
- O ganho pré-lançamento é próximo de zero: a base está praticamente vazia — o
  produto ainda não passou pelo gate do beta fechado (docs/15) e não há usuário
  real com histórico real. Por isso a migração faz um **corte limpo** (troca as
  colunas sem migração de dados em duas fases): não há linha de produção para
  preservar/recifrar.
- Errar a rotação da chave torna o histórico privado **irrecuperável**. Isso é
  disciplina operacional, e ela tinha que existir por escrito antes da cifra —
  é o procedimento descrito abaixo.

### Desenho implementado

- **Envelope, com a chave FORA do banco.** Cifra e decifra rodam em **Node**
  (`backend/src/seguranca/cifra.ts`, `node:crypto`, **AES-256-GCM**) — não
  `pgcrypto` com a chave passada como parâmetro de uma query SQL. Essa rota
  vazaria a chave-mestra para `pg_stat_statements` e para os logs do Postgres,
  o que contraria "fora do banco" — é por isso que a função `processar_cupom`
  só recebe um blob já opaco, nunca a chave nem o texto em claro.
  A chave-mestra vive só em variável de ambiente do backend
  (`CIFRA_CHAVE_ATUAL`/`CIFRA_CHAVE_ANTERIOR`), nunca em tabela, `ALTER
  DATABASE SET` ou secret do Supabase.
- **O que isto protege e o que NÃO protege** (a diferença precisa estar
  escrita para ninguém vender a cifra como garantia que ela não dá):
  - **Protege:** vazamento de *dump* do banco — e, pela mesma razão, os
    **backups** do banco (PITR/exports do Supabase herdam o texto já cifrado;
    o backup não carrega a chave, que nunca esteve no Postgres).
  - **NÃO protege:** invasão do servidor — quem tem acesso ao processo do
    backend tem acesso à chave em memória e aos valores decifrados.
  - **NÃO protege** o vazamento do **ambiente do Render** (painel de variáveis,
    export de config, log de deploy que ecoe env, conta comprometida). A partir
    da ativação, o env do Render vira um ativo tão sensível quanto o dump: quem
    tiver os **dois** tem tudo. Backup de banco e backup/registro de env nunca
    devem parar no mesmo lugar.
- **Formato do valor cifrado:** `"<versao>:<iv-base64>:<tag-base64>:<cifrado-base64>"`.
  A versão da chave viaja **dentro do próprio blob**, não numa coluna
  `chave_versao` separada — decifrar uma linha nunca depende de nenhuma outra
  coluna, e é isso que permite linhas cifradas com versões diferentes
  conviverem na mesma coluna durante uma rotação.
- **Colunas (migração `20260808090000_cifra_dados_privados.sql`):**
  - `cupom.chave_acesso` → **`cupom.chave_acesso_cifrada`** (blob AES-256-GCM,
    reversível) **+ `cupom.chave_acesso_hash`** (SHA-256 determinístico da
    chave crua, mesmo padrão de `hashChavePool`).
  - `item_cupom.descricao_original` → **`item_cupom.descricao_cifrada`** (blob
    AES-256-GCM).
- **Idempotência preservada, sobre HASH — nunca sobre o blob.** AES-GCM usa
  IV aleatório por chamada: duas cifras da mesma chave de acesso NUNCA são
  iguais como texto, então o índice único não pode mais viver na coluna
  cifrada. `cupom_usuario_chave_uniq (usuario_id, chave_acesso)` foi
  **substituído** por `cupom_usuario_chave_hash_uniq (usuario_id,
  chave_acesso_hash)` — a mesma migração remove o índice antigo e a coluna
  antiga na mesma transação (não convivem apontando para o que não existe
  mais).
  `chave_acesso_hash` é uma coluna **nova e separada** do hash global de dedup
  do pool em `chave_publicada.chave_hash` (C9.2.1): mesmo cálculo (SHA-256 da
  chave crua, via `hashChavePool`), tabelas e propósitos diferentes —
  `chave_acesso_hash` é idempotência **por usuário**; `chave_publicada` é
  dedup **global** do pool.
- **Limitação conhecida (gate de privacidade): o hash convive com o blob, e ele
  não é cifrado.** `chave_acesso_hash` é SHA-256 **puro e determinístico** — sem
  pepper. Num dump, mesmo sem a chave-mestra, ele ainda entrega duas coisas:
  1. **Ligação por igualdade.** Dois `cupom` com o MESMO hash são a mesma nota
     física — isto é, duas contas que compraram/escanearam juntas. E
     `cupom.chave_acesso_hash = chave_publicada.chave_hash` liga a conta ao
     fato de aquela chave ter publicado no pool. (`chave_publicada` guarda só
     `publicado_em` em **DATE**, dia e não hora, justamente para não virar
     correlação temporal com `observacao_preco` — isso continua valendo.)
  2. **Força bruta direcionada.** A chave de acesso é um valor ESTRUTURADO de 44
     dígitos e vários componentes estão em claro na MESMA linha (`uf`,
     `loja_cnpj`, `emitido_em`). O que sobra de incerteza real (nNF + cNF) é
     pequeno o bastante para um ataque direcionado a um usuário/loja específicos
     — SHA-256 sem pepper é barato de tentar em massa. Não é via de mão única na
     prática.
  Nada disso é **regressão**: antes desta migração a chave estava em CLARO na
  mesma coluna, então o dump entregava tudo isso e mais. Mas significa que
  "protege contra dump" vale **integralmente para as descrições de item** e
  apenas **parcialmente para a chave de acesso**.
  **Mitigação conhecida, a decidir ANTES de vender a cifra como proteção total
  da chave:** trocar o hash da coluna `cupom.chave_acesso_hash` por um *blind
  index* — HMAC-SHA256 com um pepper vindo do ambiente (nunca do banco). Mantém
  o determinismo que o índice único exige e mata os dois pontos acima. Custo:
  mais um segredo com ciclo de rotação próprio (rotacionar o pepper exige
  decifrar o blob e recalcular o hash de cada linha — factível justamente
  porque a cifra é reversível). Fica como pendência nomeada, não como bloqueio:
  a base está vazia e a ativação ainda não aconteceu.
- **A chave de acesso continua reversível — não virou hash.** O
  reprocessamento retroativo (C2.5) e o job `job:republicar` consultam a SEFAZ
  de novo a partir da chave em texto puro; `RepositorioSupabase` decifra sob
  demanda nos pontos que devolvem `chaveAcesso` para o domínio
  (`obterParaProcessamento`, `listarHistoricoDoUsuario`) — quem chama nunca
  sabe que a coluna é cifrada.
- **Onde a cifra acontece, exatamente:** `RepositorioSupabase` recebe uma
  `Cifra` (interface `cifrar`/`decifrar`) no construtor, injetada pela raiz de
  composição (`composicao.ts`) — o mesmo padrão já usado para `db`. Escreve
  cifrado em `criarOuObterPorChave` (chave de acesso) e em `marcarProcessado`
  (descrição do item, cifrada **em Node antes** de montar o payload da RPC
  `processar_cupom` — a função SQL só grava um texto opaco, nunca vê a
  descrição em claro). Decifra em `obterParaProcessamento`,
  `listarHistoricoDoUsuario` e `obterDoUsuario`. `RepositorioMemoria`
  (adaptador em memória dos testes) **não** replica a cifra — mantém texto
  puro, porque não representa risco de dump; a forma pública dos dados
  (`CupomRegistro.chaveAcesso`, `ItemCupomNovo.descricaoOriginal`) é a MESMA
  nos dois adaptadores, então nada além do repositório real sabe que a cifra
  existe.
- **Falha tardia, não falha de boot.** `criarCifra({ chaveAtual, chaveAnterior })`
  NUNCA lança por chave ausente/mal configurada só de ser construída — só
  quando `cifrar`/`decifrar` são de fato chamados. Isso é o que permite o
  servidor HTTP e jobs que nunca tocam `cupom`/`item_cupom` (ex.:
  `job:calibracao`, `job:enriquecer`) continuarem de pé mesmo sem
  `CIFRA_CHAVE_ATUAL` configurada — só o caminho de ingestão de cupom (e o
  `job:republicar`, que também lê/escreve essas colunas) falha, e falha ALTO
  (erro claro, nunca grava/lê texto puro como se estivesse cifrado).

### Como isto convive com "não ligar em produção ainda"

O código, a migração e os testes já estão no repositório, mas isso **não**
significa que a cifra está ativa em produção. Ativar tem dois passos
manuais, de propósito fora do código:

1. **Aplicar a migração** (`supabase db push` no projeto `hyscmtnptevhkmrwarey`
   — produção). Antes disso, a tabela `cupom`/`item_cupom` de produção
   continua com as colunas antigas (`chave_acesso`, `descricao_original`) e
   nada muda para quem está rodando o código ANTERIOR a esta migração.
2. **Configurar `CIFRA_CHAVE_ATUAL`** no ambiente do backend em produção
   (Render) — sem isso, o código NOVO (se chegar a rodar contra o schema
   NOVO) falha em todo caminho de ingestão, por design (ver "falha tardia"
   acima).

**São três atores, não dois — e a ORDEM importa.** Além da migração e da
variável existe o **deploy do código novo**, e as combinações erradas quebram
nos dois sentidos: código NOVO × schema ANTIGO não tem
`chave_acesso_cifrada` para escrever; código ANTIGO × schema NOVO escreve numa
coluna que não existe mais. Não há ordem que evite completamente a janela — só
uma que a torna curta e previsível:

1. **`CIFRA_CHAVE_ATUAL` no Render primeiro.** É inofensivo: o código ANTIGO
   nunca lê essa variável. Confirme que o serviço reiniciou saudável
   (`/saude/pronto` → 200) ANTES de tocar o banco.
2. **`supabase db push`.** Daqui até o passo 3 a ingestão em produção está
   quebrada (o código antigo ainda no ar escreve nas colunas removidas). Esta é
   a janela — mantenha-a em minutos.
3. **Deploy do código novo, imediatamente depois.** Depois disso: `/saude/pronto`
   → 200 e **um escaneamento real de ponta a ponta** (cupom → histórico
   legível), porque um 200 do health check não prova que a cifra funciona — as
   sondas atuais não a cobrem.

Como isto acontece **antes do beta fechado**, com base vazia e sem usuário
real, a janela do passo 2 é aceitável — depois do beta, ela vira indisponibilidade
de ingestão para gente de verdade e pede aviso/manutenção.

> **Recomendação para o backend/devops (fora do escopo do gate de privacidade):**
> a proteção mais barata contra "deploy sem a chave" é uma **sonda de saúde**
> (`observabilidade/saude.ts`) que reprove a prontidão quando
> `CIFRA_CHAVE_ATUAL` estiver ausente em produção — `falho` → `/saude/pronto`
> 503 → rollback automático do Render, exatamente o critério já documentado
> ("esta VERSÃO do código não serve"). Precisa ser crítica **só em produção**:
> em desenvolvimento rodar sem a chave é um cenário legítimo (ver o fim desta
> subseção) e não pode reprovar nada.

Por isso o gate desta seção é sobre **quando fazer o deploy** deste código
para produção — não sobre o código em si, que já está pronto. Enquanto o
gate da Fase 3 não chegar, este branch/PR não deve ser promovido ao ambiente
de produção (Render aponta para `hyscmtnptevhkmrwarey`, e os crons do GitHub
Actions rodam contra ele — ver seção 0/1 acima). Em **desenvolvimento**
(`barganha-dev`), aplicar a migração e configurar `CIFRA_CHAVE_ATUAL` no
`.env` local é seguro a qualquer momento — é exatamente o ambiente para
validar o fluxo antes do gate.

### Procedimento de rotação de chave

A rotação troca a chave-mestra sem invalidar linhas já cifradas com a chave
antiga, e sem downtime. Ela vale tanto para a **primeira ativação** (não há
"chave anterior" — é uma rotação de "nenhuma chave" para "v1") quanto para
trocas seguintes (v1 → v2, v2 → v3, ...).

**Passo 1 — gerar a chave nova.**
Rode localmente (nunca cole a chave num chat, ticket ou log):

```bash
node -e "console.log(require('./backend/src/seguranca/cifra.ts').gerarChaveEnv('2'))"
# ou, sem depender do módulo: openssl rand -base64 32 (prefixar manualmente com "2:")
```

O primeiro segmento (`2` no exemplo) é o **identificador de versão** — precisa
ser diferente de toda versão já usada. Convenção: inteiro sequencial (`1`,
`2`, `3`, ...), começando em `1` na primeira ativação.

**Passo 2 — janela de transição (as DUAS chaves configuradas).**
No ambiente do backend (Render, e `.env` local para validar antes):

```
CIFRA_CHAVE_ATUAL=2:<chave-nova-base64>
CIFRA_CHAVE_ANTERIOR=1:<chave-antiga-base64>
```

A partir do deploy com as duas variáveis:
- Toda escrita NOVA (`criarOuObterPorChave`, `marcarProcessado`) passa a
  cifrar com a v2.
- Toda leitura (`obterParaProcessamento`, `listarHistoricoDoUsuario`,
  `obterDoUsuario`) continua decifrando normalmente linhas em v1 OU v2 — o
  `criarCifra` mantém as duas chaves disponíveis e escolhe pela versão
  embutida no blob.
- Nenhuma linha existente precisa ser tocada para o sistema continuar
  funcionando. A janela de transição pode durar o quanto for prudente.

**Passo 3 — re-cifrar as linhas antigas (opcional, mas recomendado antes de
desligar a v1).**
Sem isso, linhas em v1 continuam decifráveis ENQUANTO `CIFRA_CHAVE_ANTERIOR`
estiver configurada — não há prazo automático. Para reduzir a superfície
(quanto menos linhas dependem da chave antiga, melhor), um script de backfill
pode: ler cada `cupom`/`item_cupom` cuja coluna cifrada começa com `"1:"`,
decifrar com a v1 (ainda disponível como `chaveAnterior`), cifrar de novo com
a v2 (`chaveAtual`), e fazer `update` da linha. **Regra obrigatória desse
script: `update ... where id = ...`, NUNCA `upsert`/`insert`.** Um backfill que
reinsere é um backfill que RESSUSCITA a linha de um cupom apagado pelo usuário
entre a leitura e a escrita — o direito ao apagamento não pode ser desfeito por
um job de manutenção. Com `update`, a linha apagada no meio do caminho
simplesmente casa com 0 linhas: sem erro, sem retorno dos mortos. Não existe hoje um job pronto
para isso no repositório — é trabalho a fazer SE/QUANDO a primeira rotação
real acontecer, dimensionado ao volume de linhas na época (a base cresce a
partir do beta fechado, então este não é um job de "milhões de linhas" tão
cedo).

**Passo 4 — desligar a chave antiga.**
Só depois que a Passo 3 (ou o prazo que a operação decidir tolerar) estiver
concluído: remova `CIFRA_CHAVE_ANTERIOR` do ambiente. A partir daqui, qualquer
linha que **não** foi re-cifrada (Passo 3 pulado ou incompleto) fica
**irrecuperável** — é o motivo de o Passo 3 ser fortemente recomendado antes
deste passo, não opcional na prática.

**Como reverter, se algo der errado durante a rotação:**
- **Ainda na janela de transição (Passo 2, `CIFRA_CHAVE_ANTERIOR` configurada):**
  reversão trivial — volte `CIFRA_CHAVE_ATUAL` para a chave antiga (v1) e
  remova/ignore a v2. Nenhuma linha foi perdida: as escritas feitas em v2
  durante a janela continuam decifráveis contanto que a v2 vire a
  `CIFRA_CHAVE_ANTERIOR` da reversão (ou seja: ao reverter, configure
  `CIFRA_CHAVE_ATUAL=1:...` **e** `CIFRA_CHAVE_ANTERIOR=2:...` — nunca
  descarte uma chave que já foi usada para cifrar algo).
- **Depois do Passo 4 (chave antiga já desligada):** só é reversível se a
  chave antiga ainda existir em algum backup seguro (ex.: o cofre onde ela foi
  gerada no Passo 1) — reintroduza-a como `CIFRA_CHAVE_ANTERIOR` para
  recuperar o acesso às linhas que não foram re-cifradas. **Se a chave antiga
  foi destruída e havia linhas não re-cifradas, elas são
  IRRECUPERÁVEIS** — não existe "recuperar sem a chave" numa cifra simétrica
  bem implementada, e é exatamente por isso que o Passo 3 existe antes do
  Passo 4.
- **Regra geral:** nunca destrua uma chave-mestra (v_N) enquanto QUALQUER linha
  no banco ainda começar com `"N:"`. Uma consulta simples confirma antes de
  destruir:
  ```sql
  select count(*) from cupom where chave_acesso_cifrada like '1:%'
  union all
  select count(*) from item_cupom where descricao_cifrada like '1:%';
  ```
  Ambos devem ser `0` antes de remover `CIFRA_CHAVE_ANTERIOR` de vez.

### Direito ao apagamento × cifra e rotação

Verificado no código, para não restar dúvida na hora de responder a um titular:

- **Apagar NÃO depende da chave-mestra.** `apagarDoUsuario` filtra por
  `(id, usuario_id)` e o `delete` cascateia para `item_cupom`; o apagamento de
  conta (`GerenciadorContaSupabase.apagar` → `auth.users`) cascateia para
  `usuario → cupom → item_cupom`. Nenhum dos dois lê, decifra ou compara o
  blob — para o Postgres ele é texto opaco como qualquer outro. A purga por
  inatividade (`jobs/purga-inatividade.ts`) segue o mesmo caminho. Consequência
  prática: **mesmo com `CIFRA_CHAVE_ATUAL` ausente, mal configurada ou perdida,
  o titular continua conseguindo apagar seus dados** — o direito ao apagamento
  nunca fica refém de um segredo de operação.
- **O que a chave SUSTENTA é o direito de ACESSO.** Ler o próprio histórico
  (`obterDoUsuario`, `listarHistoricoDoUsuario`, e o restore do app) exige
  decifrar. Perder a chave-mestra não é um vazamento — é uma **perda
  irreversível do dado do titular**, e portanto um incidente de disponibilidade
  a ser tratado como tal. É a razão LGPD (além da operacional) para o Passo 3
  vir sempre antes do Passo 4.
- **Cifra não é o mecanismo de apagamento.** Descartar a chave ("crypto
  shredding") apaga o histórico de TODO MUNDO, não o de um titular — nunca é
  resposta a um pedido individual. O apagamento continua sendo físico
  (`delete` + cascade), como a política de privacidade promete.
- **O pool não entra nessa conversa.** `observacao_preco` não tem
  `usuario_id`, `cupom_id` nem `chave_acesso` e nunca recebeu descrição de
  item — não há nada cifrado lá, e nada a apagar lá (docs/04).

**Gate:** o **deploy em produção** deste código (aplicar a migração + configurar
`CIFRA_CHAVE_ATUAL`) entra na Fase 3 (gate do beta fechado, docs/15), junto
com os demais itens que só passam a valer quando houver usuário real com dado
real. O código, a migração e os testes já estão prontos antes disso — só a
ativação em produção é que espera o gate.

**Revisado pelo gate de privacidade em 2026-08-08 (C9.2.2/b6): aprovado com
ajustes.** Conferido contra a decisão travada nº3 (CLAUDE.md) e o checklist de
docs/04: `chave_acesso`/descrição de item são dado do mundo PRIVADO e continuam
lá — nenhum caminho novo os leva a `observacao_preco` (a RPC insere no pool só
campos de preço, e o gate `garantirSemDadoPessoal` segue antes da escrita);
as leituras que os devolvem (`obterDoUsuario`, `listarHistoricoDoUsuario`)
continuam filtradas por `usuario_id`; o CPF não é tocado por esta mudança (o
saneamento do QR permaneceu idêntico ao da versão anterior de `processar_cupom`).
Sem vazamento em log/erro: nem `cifra.ts` nem `repositorio-supabase.ts` colocam
blob, chave-mestra ou texto decifrado em mensagem de erro, e o 500 já não
repassa a mensagem do driver (`http/erros-http.ts`) — na verdade a migração
MELHORA isso, porque um erro de violação de índice único passa a poder citar,
no máximo, o hash, e não a chave em claro como antes. **Pendências nomeadas,
nenhuma bloqueante hoje (base vazia, cifra não ativada):** (1) `chave_acesso_hash`
é SHA-256 sem pepper — ver "Limitação conhecida" acima, com a mitigação
(*blind index* HMAC) a decidir antes de a cifra ser apresentada como proteção
integral da chave de acesso; (2) nenhuma sonda de saúde cobre a cifra — ver a
recomendação em "Como isto convive com 'não ligar em produção ainda'".
