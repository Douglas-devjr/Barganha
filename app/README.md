# @barganha/app — Aplicativo Barganha (Expo / React Native)

App fino: captura + cache local + UI. A inteligência (parsing, anonimização,
estatística) mora no backend (ver `docs/01-arquitetura.md`).

## Camada 5 — Fundação Mobile (implementada)

Esqueleto do app rodando, com identidade visual e as fundações de dados/rede.
As telas reais de captura e veredito vêm em C6/C7; aqui ficam as molduras.

- **C5.1 — Projeto Expo + navegação:** Expo SDK 52 (RN 0.76, TS strict). Stack
  raiz (`src/navegacao/RaizNavegador.tsx`) com as abas + telas de fluxo (Scanner
  modal, Nota fiscal, Detalhe do produto). Abas **Início · Verificar · Produtos ·
  Perfil** com **barra customizada** e o **botão central de scan** flutuante
  (`src/navegacao/BarraAbas.tsx`).
- **C5.2 — Design system:** tokens em `src/tema/` (paleta teal `#0F766E`, fonte
  **Plus Jakarta Sans**, escala, raios e sombras) + componentes em
  `src/componentes/` (`Tela`, `Texto`, `Botao`, `Cartao`, `VeredictoBadge`,
  `CabecalhoVoltar`, ícones). O veredito reusa o tipo `Veredito` de
  `@barganha/shared` (mesma classificação do backend).
- **C5.3 — SQLite local:** `src/dados/` (expo-sqlite). Migração incremental por
  `PRAGMA user_version`. Espelho **privado** offline-first (`cupom_local`,
  `item_cupom_local`), **cache** do pool anônimo (`cache_estatistica`), **fila de
  upload** (`fila_upload`) e metadados (`meta_sync`: cursor de delta + id da conta).
- **C5.4 — Cliente de API tipado:** `src/api/` consome exclusivamente os DTOs de
  `@barganha/shared`. Endpoints: conta anônima, ingestão (Bearer), consulta e
  delta sync. Erros viram `ErroApi`; resiliente a estar offline.

### Estrutura

| Pasta | Responsabilidade |
|---|---|
| `src/tema/` | Design system (cores, tipografia, espaçamento, sombras) |
| `src/componentes/` | Componentes reutilizáveis + ícones |
| `src/navegacao/` | Stack raiz, abas e barra com scan central |
| `src/telas/` | Telas (esqueleto em C5; preenchidas em C6/C7/C8) |
| `src/dados/` | SQLite local: bd, migrações e repositórios |
| `src/api/` | Cliente HTTP tipado + resolução da URL base |
| `src/nucleo/` | Utilitários (id local) e bootstrap (conta anônima) |

O boot (`App.tsx`) carrega a fonte, inicializa o SQLite e garante a conta
anônima em background antes de montar a navegação.

## Rodar

```bash
# da raiz do monorepo
npm install

# servidor de desenvolvimento (Metro)
npm run -w @barganha/app start      # ou: android | ios | web

npm run -w @barganha/app typecheck  # tsc --noEmit
```

A URL da API vem de `EXPO_PUBLIC_API_URL` (env) ou de `extra.apiBaseUrl` no
`app.json` (padrão `http://localhost:3000`). Em device físico, use o IP da
máquina, não `localhost`.

> Monorepo: o Metro observa a raiz para resolver `@barganha/shared` da fonte TS
> (ver `metro.config.js`). O esqueleto está validado com `expo-doctor` (18/18).
