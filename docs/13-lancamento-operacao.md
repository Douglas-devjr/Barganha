# 12 — Lançamento & Operação (C10)

Runbook da Camada 10: como **publicar** o app, **observar** a operação e fazer o
**lançamento faseado** RJ + SP. Complementa `07-roadmap-mvp.md` (Fase 4) e
`10-plano-de-desenvolvimento.md` (Camada 10). *Responsáveis:* devops-engineer
(lidera), product-manager (go-to-market). *Depende de:* C7 e C9.

> **Pré-requisito de segredos.** Nada de credencial no repo. O `.gitignore` já
> bloqueia `*.jks`, `*.p8`, `*.p12`, `*.key` e a service account da Play.

---

## C10.1 — Build EAS + Google Play

### Configuração no repositório
- **`app/eas.json`** — perfis de build:
  - `development` — dev client, distribuição interna, aponta para a API local.
  - `preview` — APK de distribuição interna (QA / beta fechado por link).
  - `production` — **app-bundle (.aab)** para a Play, `autoIncrement` do versionCode.
- **`app/app.json`** — `runtimeVersion` (policy `appVersion`), `android.versionCode`,
  bloco `updates` (EAS Update) e `extra.eas.projectId`.

### Primeiro setup (uma vez)
1. `npm i -g eas-cli` e `eas login`.
2. Na pasta `app/`: `eas init` — preenche `extra.eas.projectId` e a `updates.url`
   (hoje placeholders `00000000-…`). Faça commit do resultado.
3. `eas credentials` — gera/keystore Android (guardado na conta Expo, não no repo).
4. Crie a **service account** no Google Play Console, baixe o JSON e salve como
   `app/google-play-service-account.json` (ignorado pelo git; caminho referenciado
   no perfil `submit`).

### Publicar
- **Manual:** na pasta `app/`, `eas build --platform android --profile production
  --auto-submit`.
- **Automático (CI):** workflow `.github/workflows/release.yml` dispara num push de
  tag `v*` (ou `workflow_dispatch`). Requer o segredo de repositório **`EXPO_TOKEN`**.
  Usa `--no-wait --auto-submit`: o build roda na nuvem e, ao concluir, envia à Play.

### Beta fechado → aberto
A faixa de distribuição é a **`track`** do perfil `submit` em `eas.json`:
1. **`internal`** (padrão atual) — testadores internos por e-mail. `releaseStatus: draft`.
2. **`closed`** — beta fechado (grupos/lista de testadores).
3. **`open`** — beta aberto (qualquer um com o link).
4. **`production`** — geral, com **rollout em fases** (% de usuários) no console.

Para promover, suba a `track` no `eas.json` (ou promova a release direto no console)
e ajuste `releaseStatus` para `completed`.

### OTA (correções sem nova submissão)
Mudança só de JS/regras → `eas update --branch production` entrega via EAS Update
sem passar pela revisão da loja. **Backend continua sendo a fonte da verdade**
(parsers/estatística): o app é fino e a maior parte das correções não precisa nem de OTA.

---

## C10.2 — Observabilidade

### Telemetria de parsing por estado
O parsing é o ponto mais frágil (cada portal SEFAZ muda layout sozinho). O backend
conta, **por UF**, o desfecho de cada cupom (`backend/src/observabilidade/`):

| Evento | Significado | Ação |
|---|---|---|
| `processado` | parseado + anonimizado | — |
| `falha_permanente` | layout/QR inválido | **corrigir o parser** da UF e reprocessar (C2.5) |
| `transitorio_esgotado` | portal fora do ar além do retry | investigar portal/rede; reprocessar |
| `sem_parser` | UF sem parser | esperado fora do rollout; entra com o parser novo |
| `uf_nao_habilitada` | tem parser, fora do rollout (C10.3) | habilitar a UF quando for a vez |

- **Endpoint:** `GET /metricas` — snapshot agregado (`porUf`, `totais`, `geradoEm`).
  Anônimo e sem dado de cupom. Em produção, restringir a métricas/rede interna.
- **Coletor:** `TelemetriaMemoria` (processo único). Ao escalar, trocar pelo
  exportador real (Prometheus/StatsD/OTel) — o domínio só conhece a porta `Telemetria`.

### Alertas (limiares sugeridos)
- **Taxa de falha por UF** = `falha_permanente / processado` numa janela. Acima de
  ~5% num estado → o layout provavelmente mudou: priorizar o fix do parser.
- **`transitorio_esgotado` subindo** → portal da SEFAZ instável; checar disponibilidade.
- **`processado` cai a zero** num estado ativo → ingestão ou portal parados.

### Backups & retenção
- **Postgres/Supabase:** PITR + backup diário; testar restauração periodicamente.
- O lado **compartilhado** (`observacao_preco`, `preco_estatistica`) é anônimo — backup
  sem implicação de dado pessoal. O lado **privado** vive no aparelho (SQLite); o
  backend não persiste dado pessoal (docs/04), o que reduz a superfície do backup.

---

## C10.3 — Lançamento faseado RJ + SP

Ter parser para um estado **não** liga o atendimento dele em produção — o rollout é
gradual. A fonte de verdade é a env **`UFS_HABILITADAS`** (CSV; padrão `RJ,SP`), lida
para o `ControleRollout` (`backend/src/rollout/`).

- O **processador** (worker) checa `rollout.habilitada(uf)` antes de parsear. UF com
  parser mas **fora** do rollout fica `qr_capturado` — igual a uma UF sem parser — e
  conta `uf_nao_habilitada` na telemetria (mede demanda reprimida por estado).
- **Nenhum cupom é perdido:** o QR cru fica guardado desde o dia 1 (docs/03).

### Habilitar um estado novo (playbook)
1. Garanta o parser da UF no ar e verde nos testes (C2).
2. Acrescente a UF em `UFS_HABILITADAS` (ex.: `RJ,SP,MG`) e faça o deploy.
3. Rode o **reprocessamento retroativo** (C2.5) da UF para liberar os cupons
   represados (`reprocessador.reprocessarUf('MG')`).
4. Acompanhe `GET /metricas` daquele estado (parsing/falhas) nas primeiras horas.

### Atrás de proxy
Em produção o backend fica atrás de proxy/LB. Ligue **`TRUST_PROXY=true`** para o
rate-limit (C9.3.2) enxergar o IP real do cliente via `X-Forwarded-For`.
