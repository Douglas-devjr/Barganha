# 01 — Arquitetura

## Visão geral

```
┌─────────────────────────────┐        ┌──────────────────────────────────────┐
│         APP (Expo/RN)        │        │            BACKEND (Postgres)         │
│                              │        │                                       │
│  • Captura QR (expo-camera)  │  HTTPS │  • Ingestão de QR / chave de acesso    │
│  • Banco local SQLite        │ ─────▶ │  • Parsers SEFAZ (1 por estado)        │
│    - histórico privado       │        │  • Anonimização (descarta CPF/chave)   │
│    - cache de estatísticas   │ ◀───── │  • Base colaborativa (obs. de preço)   │
│  • Tela de consulta/veredito │  delta │  • Motor estatístico (mediana/geo)     │
│  • Funciona offline          │  sync  │  • API de consulta (estatística+cache) │
└─────────────────────────────┘        └──────────────────────────────────────┘
```

## Princípio central: app fino, backend inteligente
Toda a lógica que pode mudar (parsers por estado, regras de anonimização, estatística) mora no **backend**, para ser corrigida/evoluída **sem atualizar o app na loja**. O app cuida de captura, cache local e UI.

## Componentes

### App (React Native + Expo)
- **Captura:** leitura do QR da NFC-e; armazenamento imediato do **QR cru** (funciona offline).
- **Banco local (SQLite):** histórico privado do usuário (cupons + itens) e **cache** das estatísticas de preço da região/produtos do usuário.
- **Sincronização:** fila de upload de QRs pendentes + delta sync das estatísticas.
- **Consulta:** resolve o veredito **localmente** a partir do cache; refina online quando há sinal.

### Backend (Postgres / Supabase)
- **Ingestão:** recebe o conteúdo do QR (URL/chave) e enfileira para processamento.
- **Parsers SEFAZ:** um módulo por estado, isolados atrás de uma interface comum (`parse(qr) → NotaEstruturada`). Ver `03`.
- **Anonimização:** extrai as observações de preço, **descarta CPF e chave de acesso**, e insere os itens **soltos** no pool compartilhado. Ver `04`.
- **Motor estatístico:** calcula faixas (mediana, p25, p75, mín, máx) por produto e por escopo geográfico; detecta/segrega promoção. Ver `06`.
- **API:** endpoints de ingestão e de consulta de estatísticas (com paginação/delta para o cache).

## Fluxo de dados (registro de cupom)
1. App lê o QR → grava QR cru localmente (offline-safe) → enfileira upload.
2. Backend recebe → identifica o estado → parser correspondente busca os dados estruturados na SEFAZ.
3. Backend monta a **nota privada** do usuário (volta para o app/histórico) **e** extrai **observações de preço anônimas** para o pool compartilhado.
4. Motor estatístico atualiza as faixas afetadas.

## Fluxo de dados (consulta na gôndola)
1. App resolve o veredito a partir do **cache local** (offline-first).
2. Se houver sinal, refina com a API e atualiza o cache.

## Limites e separação de dados (resumo — ver `04`)
- **Privado:** `cupom`, `item_cupom`, `chave_acesso`, `usuario_id` — nunca entram no pool compartilhado.
- **Compartilhado/anônimo:** `observacao_preco`, `preco_estatistica` — sem vínculo com usuário ou cesta.

## Escalabilidade
- Postgres atende bem à escala inicial e por bastante tempo (dados relacionais + agregações). Pontos quentes (consulta de estatística) podem ser servidos por tabelas materializadas/cache.
- Parsing é assíncrono (fila) — isola picos e falhas de portais SEFAZ.
- Estratégia detalhada de infra/escala: ver o agente **devops-engineer** e `07`.

## Decisões em aberto
- Ratificação da stack (Expo/Supabase).
- Detalhe do mecanismo de sync (timestamps vs. cursores) — a definir com o backend/data engineer.
- Estratégia de auth anônima vs. conta — a definir com privacidade + produto.
