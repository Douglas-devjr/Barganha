# @barganha/backend

Backend do Barganha: ingestão de NFC-e, parsers SEFAZ por estado, camada de
anonimização e (a partir da Camada 4) API de consulta/sync. App fino, backend
inteligente (ver `docs/01-arquitetura.md`).

## Camada 2 — Captura & Ingestão (implementada)

Fluxo de um cupom (`docs/03-captura-nfce-sefaz.md`):

```
POST /ingestao/qr ──▶ ServicoIngestao ──▶ cupom (qr_capturado) ──▶ FilaProcessamento
                          (idempotente por chave)                        │
                                                                          ▼
   observacao_preco (pool anônimo) ◀── Anonimizador ◀── ParserSefaz ◀── ProcessadorCupom
   item_cupom (histórico privado)  ◀──     (gate)          (RJ/SP)        (status + retry)
```

- **C2.1 — Ingestão:** `POST /ingestao/qr` recebe só o QR cru, valida a chave
  (sem tocar a SEFAZ), grava o cupom de forma **idempotente por chave** e
  enfileira o processamento. Responde **202** (assíncrono). QR de UF sem parser
  é **guardado** para reprocessamento.
- **C2.2 / C2.3 — Parsers RJ e SP:** `parse(qr) → NotaEstruturada` atrás de uma
  interface comum. O parsing do HTML é puro e testado com fixtures
  (`src/parsers/__fixtures__`); a busca na SEFAZ é um `ClienteSefaz` injetável.
- **C2.4 — Anonimização:** separa os dois mundos — `item_cupom` (privado) e
  `observacao_preco` **anônima e solta**, gerada **sempre** pelo gate único de
  `@barganha/shared`. CPF/chave/usuário nunca cruzam (`docs/04`).
- **C2.5 — Status & reprocessamento:** ciclo `qr_capturado → processado | falha`
  e re-enfileiramento retroativo por UF quando um parser entra no ar / é
  corrigido.

### Decisões de retry (fila)

A fila só repete quando o worker **lança**. Erro **transitório** (portal fora do
ar, rede, banco) → retry com backoff exponencial. Erro **permanente** (layout,
QR inválido) → cupom marcado `falha`, sem retry. UF sem parser → fica
`qr_capturado` aguardando C2.5.

## Camada 4 — API de Consulta & Sync (implementada)

Endpoints que servem o app rápido e habilitam o offline (`docs/05`). Consulta e
sync lêem **só o pool compartilhado anônimo** — não exigem conta (`docs/04`).

- **C4.1 — Consulta de preço:** `POST /consulta/preco` resolve o produto por
  **EAN** (principal) ou **nome** (fallback, casamento por texto de C3.5) e
  devolve a faixa típica no nível mais específico com base suficiente, reusando o
  **fallback geográfico** loja→município→região→UF (C3.3). Sem dado → **404**.
- **C4.2 — Delta sync:** `POST /sync/estatisticas` baixa só o que mudou desde o
  **cursor** (`atualizado_em`), no escopo do usuário (municípios + produtos do
  histórico). Devolve as linhas + o novo cursor. Janela pequena por design
  (`docs/05`); paginação por cursor composto fica para C9.3.
- **C4.5 — Delta de catálogo:** `POST /sync/produtos` recebe um lote de ids
  (teto de 200) e devolve o `ProdutoResumo` de cada um — nome/marca/categoria +
  `unidadeBase`. É o que dá NOME, offline, ao id que o delta de estatística
  conhece só pelo preço. Sem cursor de propósito: quem sabe o que falta é o app.
  Id desconhecido apenas não volta (nunca 404 — um produto removido não pode
  derrubar o lote inteiro).
- **C4.3.1 — Auth real (login obrigatório):** os endpoints **privados**
  (ingestão, `DELETE /conta`) exigem `Authorization: Bearer <JWT do Supabase>`.
  O `AutenticadorSupabase` valida o token (`auth.getUser`) e usa o `sub`
  (= `auth.users.id`) como `usuarioId` — que identifica **só** o lado privado
  (`docs/04`). `DELETE /conta` aplica o **direito ao apagamento**
  (`auth.admin.deleteUser` → cascata em `usuario`/`cupom`/`item_cupom`).
  A conta anônima de C4.3 (`POST /conta/anonima` + `Autenticador` por UUID)
  permanece **só** como afordância de teste/legado e não sobe em produção.

## Estrutura

| Pasta | Responsabilidade |
|---|---|
| `parsers/` | Identidade da NFC-e (chave/cUF/QR), interface `ParserSefaz`, RJ, SP, registro |
| `anonimizacao/` | Normalização R$/base, casamento por EAN, anonimizador (usa o gate) |
| `ingestao/` | Serviço de ingestão (C2.1) |
| `processamento/` | Processador de cupom + reprocessamento retroativo (C2.5) |
| `estatistica/` | Motor de veredito: agregação, escopos/fallback, pipeline, casamento por texto (C3) |
| `consulta/` | Serviço de consulta de preço com fallback geo (C4.1) |
| `sync/` | Serviço de delta sync incremental (C4.2) |
| `auth/` | Auth por JWT do Supabase + apagar conta (C4.3.1); conta anônima legado (C4.3) |
| `fila/` | Fila com retry/backoff (porta + adaptador em memória) |
| `persistencia/` | Portas + adaptador Supabase + adaptador em memória (testes) |
| `sefaz/` | `ClienteSefaz` HTTP (real) e em memória (testes) |
| `http/` | Servidor Fastify (ingestão, conta, consulta, sync, `GET /saude`) |

Portas e adaptadores: o domínio não conhece Supabase nem rede; tudo é injetado
na raiz de composição (`composicao.ts`). Isso mantém a lógica testável sem
infra e permite trocar peças (ex.: fila durável na infra de C10).

## Rodar

```bash
# Variáveis (ver .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT
npm run -w @barganha/backend dev      # servidor com reload (tsx)
npm run -w @barganha/backend start    # servidor

npm test            # testes (vitest, da raiz)
npm run typecheck   # tsc --noEmit
```

> As fixtures de HTML **modelam** o layout de cada portal e não são capturas
> reais — substituí-las/ampliá-las por cupons reais é tarefa da suíte de QA
> (C9.1). Parsers são versionados para acompanhar mudanças de layout (`docs/03`).
