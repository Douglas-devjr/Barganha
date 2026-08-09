# 11 — Catálogo de Etapas (como pedir uma implementação)

Este documento dá um **nome e um código curto** a cada etapa do desenvolvimento (detalhadas em `10-plano-de-desenvolvimento.md`) e define **como citá-las no chat** para o Claude entender que deve **implementar** aquela etapa.

---

## Como citar no chat

- **Implementar uma camada inteira:** escreva o código. Ex.: `C2`, ou “implementar C2”, ou “bora a Camada 2”.
- **Implementar um sub-passo específico:** use o código com o ponto. Ex.: `C2.2` (parser RJ).
- **Implementar uma faixa de camadas:** use o traço. Ex.: `C0–C1` ou “C5 a C7”.
- **Fatia vertical (recomendada para começar):** `FV`.
- **Só planejar / ver status (sem codar):** prefixe com **planejar** ou **status**. Ex.: “status C3”, “planejar C4”.

### O que o Claude faz ao receber um código
1. Confirma rapidamente o escopo se a etapa for grande; se for pequena/clara, já executa.
2. Verifica **dependências** — se faltar uma camada anterior, avisa e sugere fazê-la antes.
3. Aciona o(s) **agente(s) responsável(is)** da etapa.
4. Implementa, escreve testes quando couber, e **commita** pelo padrão (`git-committer`, **sem co-autoria do Claude**).
5. Reporta o que entregou e qual o próximo passo lógico.

> Os códigos não são slash-commands — é só escrever no chat. Verbos como “implementar”, “construir”, “fazer”, “bora” são opcionais.

---

## Tokens especiais

| Código | Nome | O que é |
|---|---|---|
| `FV` | **Fatia Vertical** | Fluxo fino ponta a ponta de **um cupom do RJ**: capturar → parsear → salvar → ver no histórico → veredito simples. Valida a integração antes de engrossar as camadas. Usa partes de C1, C2, C5, C6, C7. |
| `MVP` | **Produto Mínimo** | Tudo marcado `[MVP]` no plano (C0–C7 essenciais + C8.1/C8.2 + C9 + C10). |

---

## Catálogo de camadas e sub-passos

### `C0` — Fundação *(Setup & Tooling)* `[MVP]`
| Código | Sub-passo |
|---|---|
| C0.1 | Monorepo (`app/`, `backend/`, `shared/`) |
| C0.2 | Tooling: TS strict, ESLint, Prettier, EditorConfig |
| C0.3 | CI (lint+test) + ambientes + segredos |
| C0.4 | Provisionar Postgres/Supabase + base de migrations |
*Responsáveis:* devops-engineer, tech-lead-arquiteto

### `C1` — Domínio *(Modelo de Dados & Contratos)* `[MVP]`
| Código | Sub-passo |
|---|---|
| C1.1 | Modelo de dados v1 mapeado às telas |
| C1.2 | Migrations (lado privado + compartilhado) |
| C1.3 | Tipos/contratos em `shared/` (`NotaEstruturada`, DTOs) |
| C1.4 | Fronteira de anonimização (gate único de escrita) |
*Responsáveis:* tech-lead-arquiteto, data-engineer, privacy-lgpd-specialist

### `C2` — Captura *(Ingestão SEFAZ)* `[MVP]`
| Código | Sub-passo |
|---|---|
| C2.1 | Endpoint de ingestão do QR + fila (retry/backoff) |
| C2.2 | Parser **RJ** (fixtures/testes) |
| C2.3 | Parser **SP** (fixtures/testes) |
| C2.4 | Camada de anonimização (nota privada + `observacao_preco`) |
| C2.5 | Status do cupom + reprocessamento retroativo |
*Responsáveis:* sefaz-integration-engineer, backend-engineer

### `C3` — Estatística *(Motor de Veredito)* `[MVP]`
| Código | Sub-passo |
|---|---|
| C3.1 | Pipeline `preco_estatistica` (mediana/percentis/mín/máx/`n`) |
| C3.2 | Decaimento temporal |
| C3.3 | Escopos geo + fallback hierárquico (loja→município→região→UF) |
| C3.4 | Casamento por EAN + mapa de unidades em 4 grupos (fator fixo; um volume = 1 item; multipack só com contagem declarada; não-comparável por natureza), plural automático e ranking durável das abreviações que faltam em `GET /metricas` |
| C3.5 | Casamento por texto (sem EAN, com confirmação) |
| C3.6 | Detecção de promoção + veredito híbrido (pessoal + regional) |
*Responsáveis:* data-scientist, data-engineer

### `C4` — API *(Consulta & Sync)* `[MVP]`
| Código | Sub-passo |
|---|---|
| C4.1 | Endpoints de consulta de estatística (com fallback) |
| C4.2 | Delta sync (cursor por `atualizado_em` + escopo) |
| C4.3 | Autenticação mínima |
| C4.3.1 | Endurecer o token de conta: hoje o `usuarioId` (UUID) É o Bearer (sem segredo) — quem obtém o id ingere no histórico alheio. Evoluir p/ token/segredo próprio ou Supabase Auth/JWT |
| C4.4 | Busca de produtos no pool (`POST /consulta/produtos`) — anônima, por termo (casamento de texto) ou **populares da região**, com o mesmo fallback geo da consulta. Destrava o **cold start**: conta nova sem cupom já monta lista e compara (ver `docs/20-cold-start-e-catalogo-regional.md`) |
| C4.5 | Delta de catálogo (`POST /sync/produtos`): desce `ProdutoResumo` (nome/marca/categoria) dos ids já em cache p/ o catálogo regional ficar navegável **offline** — lote de ids sem cursor, cache local `cache_produto` revalidado a cada 7 dias |
*Responsáveis:* backend-engineer, data-engineer, privacy-lgpd-specialist

### `C5` — Esqueleto *(Fundação Mobile)* `[MVP]`
| Código | Sub-passo |
|---|---|
| C5.1 | Projeto Expo + navegação (tabs + scan central) |
| C5.2 | Design system (paleta `#0F766E`, Plus Jakarta Sans, componentes) |
| C5.3 | SQLite local (espelho privado + cache de estatísticas) |
| C5.4 | Cliente de API tipado (usa `shared/`) |
*Responsáveis:* mobile-engineer, ux-designer

### `C6` — Cupom *(Captura Offline-first)* `[MVP]`
| Código | Sub-passo |
|---|---|
| C6.1 | Câmera/leitura de QR + grava QR cru local |
| C6.2 | Fila de upload idempotente (`chave_acesso`) + retry |
| C6.3 | Tela Nota fiscal + “Salvar no histórico” |
| C6.4 | Onboarding (3 telas) + consentimento LGPD |
*Responsáveis:* mobile-engineer, ux-designer, privacy-lgpd-specialist

### `C7` — Veredito *(Consulta na Gôndola)* `[MVP]`
| Código | Sub-passo |
|---|---|
| C7.1 | Tela Verificar (scan de barras + busca por nome) |
| C7.2 | Veredito do cache local (offline) + refino online |
| C7.3 | Exibição híbrida + linha de promoção + “última atualização” |
| C7.4 | Produtos (lista) |
| C7.5 | Detalhe do produto (gráfico de evolução 6 meses) |
| C7.6 | Catálogo regional no app (cold start): o sheet de adicionar item e o Comparar mercados mesclam histórico + busca no pool (C4.4); sem histórico, mostram os populares da região |
| C7.7 | Escopo do delta sync inclui os ids da **lista de compras** — produto só listado, nunca comprado, hoje fica sem preço offline |
*Responsáveis:* mobile-engineer, ux-designer, data-scientist

### `C8` — Histórico *(Histórico, Estatísticas & Perfil)*
| Código | Sub-passo |
|---|---|
| C8.1 | Início: card de descontos + últimas compras `[MVP]` |
| C8.2 | Perfil: dados mínimos, mercados favoritos, preferências `[MVP]` |
| C8.3 | Estatísticas (gastos por mês/categoria/onde economiza) `[Pós]` |
| C8.4 | Economia acumulada + tendência + alertas de preço `[Pós]` |
| C8.4.1 | **Economia real** (pagou × típico) — a captura do snapshot por item já está feita; falta a UI, e o gatilho é **cobertura medida**, não data. Condições inegociáveis e fórmula em `docs/06 §Economia real` `[Pós]` |
*Responsáveis:* mobile-engineer, ux-designer, product-manager

### `C9` — Qualidade *(QA, Privacidade & Performance)* `[MVP]` *(transversal)*
| Código | Sub-passo |
|---|---|
| C9.1 | Pirâmide de testes (unit→e2e) + fixtures de cupons |
| C9.2 | Gate LGPD + checagem de re-identificação |
| C9.2.1 | Dedup global do pool por hash da chave (`chave_publicada`): contas diferentes com o MESMO cupom publicam uma vez — anti-distorção da mediana e anti-abuso multi-conta |
| C9.2.2 | Cifra por envelope de `chave_acesso`/descrição do item (reversível, chave fora do banco) — código e migração prontos; ativação em produção aguarda o gate da Fase 3 (beta fechado) |
| C9.3 | Performance (índices/EXPLAIN) + plano de escala |
| C9.3.1 | Ingestão transacional: `marcarProcessado` numa função SQL (RPC) — hoje são escritas sequenciais e uma falha parcial após inserir no pool pode duplicar observações no retry |
| C9.3.2 | Rate-limit/anti-abuso: teto por IP e por conta, contado no Postgres (`rate_limit_janela`) para valer em todas as instâncias — fecha a criação em massa de contas e a raspagem do pool público |
| C9.4 | Política de privacidade publicada |
*Responsáveis:* qa-engineer, privacy-lgpd-specialist, data-engineer

### `C10` — Lançamento *(Release & Operação)* `[MVP]`
| Código | Sub-passo |
|---|---|
| C10.0 | Conformidade de loja (docs/14): política em URL pública (C9.4), página web de exclusão de conta, Data Safety, classificação, **target API 36** (upgrade Expo SDK 54+) |
| C10.1 | Build EAS + Google Play (beta fechado → aberto) |
| C10.2 | Observabilidade (telemetria por estado, alertas, backups) |
| C10.3 | Lançamento faseado RJ + SP |
*Responsáveis:* devops-engineer, product-manager, privacy-lgpd-specialist

### `C11` — Expansão *(Pós-lançamento)* `[Pós]`
| Código | Sub-passo |
|---|---|
| C11.1 | Novos estados + reprocessamento retroativo |
| C11.2 | iOS / App Store |
| C11.3 | Lançamento manual de gôndola (com moderação) |
| C11.4 | OCR de cupons ECF antigos |
| C11.5 | Enriquecimento de produtos (nome/foto/categoria) — manual via curadoria **e automático via catálogo VTEX** (`job:enriquecer`, redes em `REDES_VTEX`) |
*Responsáveis:* conforme o item

### `C12` — Diferenciação *(Pós-lançamento — benchmark de mercado)* `[Pós]`
Features que fazem o app ser escolhido, inspiradas no que funciona nos
concorrentes (Preço da Hora BA, Menor Preço RS/PR, apps de cashback por nota).
Alertas de preço e economia acumulada já estão em **C8.4**.
| Código | Sub-passo |
|---|---|
| C12.1 | Lista de compras comparada por mercado ("onde minha cesta sai mais barata") |
| C12.2 | Gamificação da contribuição (sequências, selos, contador de cupons enviados) |
| C12.3 | Recortes de combustíveis e farmácia (curadoria de categoria + UI) |
| C12.4 | Ofertas anunciadas (fontes externas): tabela `oferta_anunciada` + coleta via adaptador VTEX + exibição SEPARADA no app — **nunca no pool/mediana** (regra travada; o cliente VTEX do C11.5 já lê o preço). Mesmo encaixe recebe, na Fase 2, o **feed de parceria** dos mercados (ver `docs/18-ofertas-e-monetizacao.md`) |
| C12.5 | Denúncia de preço incorreto: tabela `denuncia_preco` (PRIVADA) + `POST /denuncia` + fila de curadoria. O alvo é **produto + recorte geo**, nunca uma `observacao_preco` — não existe ponteiro de usuário para linha do pool (decisão travada nº3). Denunciar **não publica nada**: é sinal para a curadoria corrigir casamento/unidade com as ferramentas do C11 |
*Responsáveis:* product-manager, data-scientist, mobile-engineer, ux-designer

### `C13` — Assinatura *(Monetização pelo usuário)* `[Pós]`
Planos grátis × pago. **Duas regras travadas** (ver `docs/21-assinatura-e-planos.md`):
escanear cupom é ilimitado no grátis para sempre, e o veredito é o mesmo para
todo mundo — pagar não compra uma verdade melhor.
| Código | Sub-passo |
|---|---|
| C13.1 | Conceito de direito (entitlement): `Plano`/`Recurso` + `podeUsar()` em `shared/`, coluna de plano no modelo, todo mundo em `gratis`. É o gancho barato que evita refatorar 25 telas depois |
| C13.2 | Backend da assinatura: tabela `assinatura` (PRIVADA, com RLS), estado exposto na conta (`plano`, `valido_ate`). **Depende de C4.3.1** — não se vende assinatura sobre um Bearer que é o próprio `usuarioId` |
| C13.3 | Google Play Billing: compra no app + webhook (RTDN) → backend confirma na API do Play. Entitlement **nunca** decidido pelo cliente; cancelamento/reembolso/carência refletidos, não inventados |
| C13.4 | Plus por contribuição: job mensal que concede o mesmo direito a quem teve ≥ 4 cupons **processados** no mês anterior (`plus_contribuindo`) |
| C13.5 | Gates no app: cache do plano no SQLite com folga de 7 dias sem rede (paywall tem de funcionar offline, no corredor do mercado) + telas de limite com cadeado e prévia do valor — recurso bloqueado aparece, não some |
*Responsáveis:* product-manager, tech-lead-arquiteto, backend-engineer, mobile-engineer, privacy-lgpd-specialist

---

## Exemplos de uso no chat
- `FV` → “monta a fatia vertical do RJ ponta a ponta”.
- `C0` ou “implementar C0” → faz toda a Fundação.
- `C2.2` → só o parser do RJ, com testes.
- `C5–C7` → o app do esqueleto ao veredito.
- “status C3” → relatório da camada, **sem** codar.

> Ordem sugerida: `C0 → C1 → FV → engrossar C2/C3/C4 + C5/C6/C7 → C8 → C9 → C10`.
