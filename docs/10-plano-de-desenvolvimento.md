# 10 — Plano de Desenvolvimento (em camadas)

Sequência lógica do desenvolvimento, **camada por camada**, do zero ao app completo. Cada camada depende da anterior. Complementa o faseamento de produto de `07-roadmap-mvp.md` (aqui o corte é **técnico/por camada**).

> **Estratégia recomendada — fatia vertical primeiro.** Não construa cada camada 100% antes da próxima. Depois das Camadas 0–1, faça uma **fatia vertical fina** (um cupom de RJ: escanear → parsear → salvar → ver no histórico → veredito simples) para validar a integração ponta a ponta. Só então engrosse cada camada. Isso elimina cedo o maior risco: a costura entre app, backend e SEFAZ.

Legenda: **[MVP]** entra no produto mínimo · **[Pós]** fase posterior.

---

## Camada 0 — Fundação & Tooling **[MVP]**
*Objetivo:* ter o terreno pronto para codar com qualidade e CI desde o primeiro dia.
- Monorepo: `app/` (Expo), `backend/`, `shared/` (tipos TS compartilhados).
- TypeScript (strict), ESLint, Prettier, EditorConfig.
- CI (lint + testes) e ambientes (`.env.example`, gestão de segredos).
- Provisionar Postgres/Supabase (dev) e estrutura de migrations.
- Branch/PR strategy; padrão de commits já definido (`09`).

*Responsáveis:* devops-engineer (lidera), tech-lead-arquiteto. *Depende de:* —

## Camada 1 — Domínio & Dados **[MVP]**
*Objetivo:* o modelo de dados v1 e os contratos que todo o resto consome.
- Modelo de dados v1 (entidades de `02`) **mapeado às telas** do protótipo.
- Migrations: lado **privado** (`cupom`, `item_cupom`) e **compartilhado** (`loja`, `produto_canonico`, `produto_alias`, `observacao_preco`, `preco_estatistica`).
- Tipos/contratos em `shared/`: `NotaEstruturada`, DTOs de API.
- Fronteira de anonimização desenhada como conceito de código (gate único de escrita no pool).

*Responsáveis:* tech-lead-arquiteto (contratos), data-engineer (schema), privacy-lgpd-specialist (revisão). *Depende de:* 0

## Camada 2 — Captura & Ingestão (SEFAZ) **[MVP]**
*Objetivo:* transformar o QR de uma NFC-e em dados estruturados confiáveis.
- Endpoint de ingestão do QR + fila assíncrona (retry/backoff).
- Interface `ParserSefaz` + parser **RJ** e **SP** com fixtures/testes.
- **Camada de anonimização:** monta a nota privada **e** extrai `observacao_preco` anônima — descarta CPF e chave, itens soltos.
- Ciclo de status do cupom + reprocessamento retroativo por estado.

*Responsáveis:* sefaz-integration-engineer (parsers), backend-engineer (ingestão/anonimização). *Depende de:* 1

## Camada 3 — Motor Estatístico **[MVP]**
*Objetivo:* a inteligência do veredito barato/normal/caro.
- Pipeline `preco_estatistica`: mediana, p25/p75, mín/máx, `menor_promocional`, `n_observacoes`, **decaimento temporal**.
- Escopos geográficos + **fallback hierárquico** (loja→município→região→UF).
- Casamento de produto: **EAN** direto; **texto** (com confirmação) para itens sem EAN.
- Detecção/segregação de **promoção**; lógica do **veredito híbrido** (pessoal + regional).

*Responsáveis:* data-scientist (algoritmos/calibração), data-engineer (pipeline). *Depende de:* 2

## Camada 4 — API de Consulta & Sync **[MVP]**
*Objetivo:* servir o app rápido e habilitar o offline.
- Endpoints de consulta de estatística por produto/escopo (com fallback).
- **Delta sync** (cursor por `atualizado_em` + escopo da região/produtos do usuário).
- Autenticação mínima (avaliar conta anônima) e regras de acesso.

*Responsáveis:* backend-engineer (lidera), data-engineer, privacy-lgpd-specialist. *Depende de:* 3

## Camada 5 — App: Fundação Mobile **[MVP]**
*Objetivo:* o esqueleto do app rodando, com identidade visual.
- Projeto Expo + navegação (tabs: Início · Verificar · Produtos · Perfil + scan central).
- **Design system** do protótipo (paleta teal `#0F766E`, fonte Plus Jakarta Sans, componentes).
- **SQLite local**: espelho do lado privado + cache de estatísticas.
- Cliente de API tipado (usa `shared/`).

*Responsáveis:* mobile-engineer (lidera), ux-designer (design system). *Depende de:* 4 (contratos) — pode começar em paralelo após a Camada 1

## Camada 6 — App: Captura Offline-first **[MVP]**
*Objetivo:* registrar cupom funciona sempre, com ou sem sinal.
- Câmera/leitura de QR (`expo-camera`); grava **QR cru** local antes de tudo.
- Fila de upload idempotente (`chave_acesso`) + retry.
- Tela **Nota fiscal** (itens parseados) → "Salvar no histórico".
- **Onboarding** (3 telas) + **consentimento LGPD**.

*Responsáveis:* mobile-engineer, ux-designer, privacy-lgpd-specialist (consentimento). *Depende de:* 5, 2

## Camada 7 — App: Consulta & Veredito **[MVP]**
*Objetivo:* o momento de valor — saber na gôndola se o preço está bom.
- Tela **Verificar**: **scan de código de barras (principal)** + busca por nome (fallback).
- Veredito resolvido do **cache local** (offline), refinado online.
- Exibição **híbrida** (seu histórico + típico da região) + linha de **promoção** + "última atualização".
- **Produtos** (lista) e **Detalhe do produto** (gráfico de evolução 6 meses).

*Responsáveis:* mobile-engineer, ux-designer, data-scientist (regras de exibição). *Depende de:* 6, 3

## Camada 8 — App: Histórico, Estatísticas & Perfil
*Objetivo:* fechar a experiência e o engajamento recorrente.
- **Início**: card de economia + Últimas compras **[MVP]**.
- **Perfil**: dados mínimos, mercados favoritos, preferências, sair **[MVP]**.
- **Estatísticas** (gastos por mês/categoria/onde economiza) e **Economia acumulada** **[Pós]**.
- Tendência de preço e **alertas de preço** **[Pós]**.

*Responsáveis:* mobile-engineer, ux-designer, product-manager (priorização). *Depende de:* 7

## Camada 9 — Qualidade, Privacidade & Performance **[MVP]**
*Objetivo:* garantir que funciona, é seguro e escala. *(Transversal — acompanha todas as camadas.)*
- Pirâmide de testes (unit → integração → e2e) + fixtures de cupons reais.
- **Gate LGPD** automatizado + checagem de re-identificação (`04`).
- Performance de consulta (EXPLAIN/ANALYZE, índices) e plano de escala.
- **Ingestão transacional** (C9.3.1): mover a escrita de `marcarProcessado` para uma função SQL (RPC) atômica — evita duplicar no pool em falha parcial do retry.
- Política de privacidade publicada.

*Responsáveis:* qa-engineer (lidera), privacy-lgpd-specialist, data-engineer. *Depende de:* contínuo

## Camada 10 — Lançamento & Operação **[MVP]**
*Objetivo:* colocar na mão dos usuários e operar com segurança.
- Build **EAS** + publicação na **Google Play** (beta fechado → aberto).
- Observabilidade: telemetria de parsing **por estado**, alertas, monitoramento, backups.
- **Lançamento faseado RJ + SP**.

*Responsáveis:* devops-engineer (lidera), product-manager (go-to-market). *Depende de:* 7, 9

## Camada 11 — Expansão **[Pós]**
*Objetivo:* crescer cobertura e plataformas.
- Novos estados (reprocessamento retroativo dos QRs pendentes).
- **iOS / App Store**.
- Lançamento manual de gôndola (com moderação).
- **OCR** de cupons ECF antigos.
- Enriquecimento de produtos (nome/foto/categoria).

*Responsáveis:* todos, conforme o item. *Depende de:* 10

---

## Caminho crítico (resumo)
`0 → 1 → 2 → 3 → 4` (backbone de dados) e, em paralelo a partir de 1, `5 → 6 → 7` (app), costurados pela **fatia vertical** logo cedo. `9` é transversal; `10` fecha o MVP; `11` é expansão.

## Marco do MVP (pronto quando…)
Escanear cupom de RJ/SP → ver itens no histórico → consultar produto na gôndola (offline) → receber veredito híbrido coerente — **sem nenhum dado pessoal persistido** e com o gate LGPD verde.
