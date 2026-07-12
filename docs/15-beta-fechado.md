# 15 — Beta Fechado (C10.1 / Fase 3)

Runbook do teste fechado exigido pela Google Play para contas pessoais novas:
**12+ testadores ativos por 14 dias corridos** antes de poder pedir produção.
Complementa `13-lancamento-operacao.md` e `14-conformidade-play-store.md`.

> **Gate de pagamento:** este é o momento do ÚNICO gasto pré-lançamento —
> **US$ 25** (taxa única da conta de desenvolvedor). Todo o resto segue R$ 0.

---

## Pré-requisitos (conferir antes de pagar os US$ 25)

- [ ] Fase 0 validada no device: cupom RJ processa; recusa do reCAPTCHA se recupera sozinha.
- [ ] Fase 1 no ar: backend no Render free (`GET /saude` ok), migrations aplicadas, crons ativos.
- [ ] Fase 2 publicada: política + exclusão de conta no GitHub Pages, campos preenchidos.
- [ ] Upgrade Expo SDK 54 validado no device (**novo dev build** — o binário antigo não abre o JS novo).
- [ ] `EXPO_PUBLIC_API_URL` de `preview`/`production` no `app/eas.json` apontando para o Render.

## Passo 1 — Conta e app no Play Console (1º dia)

1. Criar a conta de desenvolvedor (US$ 25, pessoa física): <https://play.google.com/console/signup>.
2. Criar o app (**Barganha**, app, gratuito, PT-BR).
3. Preencher *Política do app*: URL da política, URL de exclusão de conta,
   **Data Safety** e classificação — respostas prontas em `docs/14`.
4. Criar a **faixa de teste fechado** (alpha) e a lista de testadores por e-mail.

## Passo 2 — Build e envio

```powershell
cd app
eas build --platform android --profile production
```

- Primeiro envio: baixar o `.aab` e subir manualmente na faixa de teste fechado
  (o primeiro upload de um app novo é manual; os seguintes podem usar
  `--auto-submit` / workflow `release.yml`).
- Compartilhar o **link de opt-in** da faixa com os testadores.

## Passo 3 — Recrutamento (meta: 20 pessoas, mínimo seguro p/ 12 ativos)

Perfil: Android, e-mail Google, mora em RJ ou SP, faz mercado com alguma
frequência. Amigos/família contam. Modelo de mensagem:

> Oi! Estou lançando um app que te diz se o preço do mercado está caro ou
> barato — você escaneia o QR do cupom fiscal e ele monta seu histórico e
> compara com os preços da região, tudo anônimo. Preciso de 20 pessoas com
> Android para testar por 2 semanas (uso normal, sem obrigação além de escanear
> os cupons das suas compras). Topa? É só abrir este link no celular: [opt-in]

Regra de ouro do Google: os 14 dias contam com os testadores **contínuos** —
recrutar todos na mesma semana e não deixar o grupo esvaziar.

## Passo 4 — Semeadura da base (o beta é também o povoamento)

- Meta por testador: **2+ cupons/semana** (o próprio mercado da pessoa).
- Concentrar em **1–2 municípios** (onde os testadores moram) para a
  estatística regional ficar densa rápido — melhor 2 cidades densas que 10 ralas.
- Acompanhar no Supabase Studio: `telemetria_parsing` (dia × UF × evento) e
  crescimento de `observacao_preco`/`preco_estatistica`.

## Passo 5 — QA dirigido durante os 14 dias

| Cenário | O que validar |
|---|---|
| Cupom RJ com recusa do reCAPTCHA | recarga automática (até 4×) resolve; cupom nunca vira `falha` |
| Item sem EAN (RJ) | casamento por texto + job `republicar-pool` preenchendo o pool |
| Mercado sem sinal | registrar offline → sincroniza ao voltar; veredito do cache |
| Câmera (pós-SDK 54) | scanner QR e barras abrem rápido; sem tela preta ao alternar apps |
| Exclusão de conta | Perfil → Apagar conta remove tudo; login de novo começa zerado |
| Veredito na gôndola | coerente com a região semeada; escanear produto conhecido |

## Critérios de saída (para promover a produção)

- 12+ testadores contínuos por 14 dias (requisito do Google cumprido).
- Taxa de sucesso de parsing (`processado / (processado + falha_permanente + erro_portal)`) **> 90%** por UF ativa.
- Veredito coerente nos municípios semeados (validação manual com preços reais).
- Zero incidentes de privacidade (gate C9.2 revalidado com dados reais).
- Crash-free > 99% (Play Console → Vitals).

## Custo total da fase

**US$ 25** (único, conta de desenvolvedor). Infra segue no free tier.
