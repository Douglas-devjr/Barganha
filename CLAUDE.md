# Barganha — Guia do Projeto (CLAUDE.md)

> App mobile que escaneia cupons fiscais (NFC-e), monta uma base **colaborativa e anônima** de preços e diz, na gôndola, se um produto está **barato, na média ou caro** — sempre por unidade comparável (R$/kg, R$/L, R$/un).

O nome do app é **Barganha** (a pasta do repositório se chama `Comparai`, nome de trabalho).

---

## Status
Fase: **fim da ideação / início do desenvolvimento.** O escopo e as restrições já estão fechados (ver `docs/`). O design das telas será fornecido pelo dono do produto e definirá o ajuste final do modelo de dados.

## Como navegar este repositório
- **`painel/`** — o **painel visual do projeto** (`npm run painel` → `painel/index.html`): status real de cada etapa, o que cada função faz e com quem conversa, regras de negócio, bloqueadores da publicação. **Ao concluir ou alterar qualquer etapa, atualize o item em `painel/mapa.mjs` e regenere** — o `npm run check` e o CI rodam `painel:conferir` e reprovam se o mapa divergir do código. Ver `painel/README.md`.
- **`docs/`** — a fonte da verdade do produto e da arquitetura. Leia antes de codar.
  - `00-visao-produto.md` · `01-arquitetura.md` · `02-modelo-de-dados.md` · `03-captura-nfce-sefaz.md` · `04-privacidade-lgpd.md` · `05-offline-sync.md` · `06-comparacao-estatistica.md` · `07-roadmap-mvp.md` · `08-equipe-agentes.md` · `09-padrao-commits.md` · `10-plano-de-desenvolvimento.md` · `11-catalogo-de-etapas.md` · `12-qualidade-performance-escala.md` · `13-lancamento-operacao.md` · `14-conformidade-play-store.md` · `15-beta-fechado.md` · `16-lancamento-aberto.md` · `17-fontes-catalogo.md` · `18-ofertas-e-monetizacao.md` · `19-ambientes-e-endurecimento.md` · `20-cold-start-e-catalogo-regional.md` · `21-assinatura-e-planos.md` · `politica-de-privacidade.md`
- **`site/`** — páginas legais estáticas (política de privacidade + exclusão de conta) publicadas via GitHub Pages (ver `site/README.md`).

## Códigos de etapa (como o dono pede implementações)
O dono cita etapas pelo **código** definido em `docs/11-catalogo-de-etapas.md` (ex.: `C2`, `C2.2`, `C5–C7`, `FV`, `MVP`). Ao receber um código: confira dependências, acione o agente responsável, implemente e commite pelo padrão. Prefixos **planejar**/**status** = só planejar, sem codar.
- **`.claude/agents/`** — o time de agentes especialistas. Delegue cada tarefa ao agente da área correspondente (ver `docs/08-equipe-agentes.md`).

---

## Decisões travadas (NÃO-NEGOCIÁVEIS)

Toda contribuição de código ou design DEVE respeitar:

1. **Captura QR-first.** Os dados vêm do **QR code da NFC-e** consultado na **SEFAZ** (estruturados), não de OCR. OCR é plano B futuro para cupons ECF antigos.
2. **Parsing da SEFAZ roda no backend, nunca no app.** Um parser por estado. O app só envia o conteúdo do QR e guarda o **QR cru** de qualquer estado desde o dia 1, para processamento retroativo.
3. **LGPD forte — nunca persistir dados pessoais.** CPF é descartado no parsing. Dois mundos de dados estritamente separados:
   - **Privado** (`cupom`, `item_cupom`): histórico do usuário, idealmente no aparelho / escopo da conta. Contém `chave_acesso`.
   - **Compartilhado** (`observacao_preco`): anônimo de nascença, itens **soltos** (sem amarrar à cesta), **sem** `usuario_id`, **sem** `chave_acesso`.
4. **Geolocalização pela LOJA (via CNPJ), nunca rastreando o usuário.** Agregação principal por município; fallback hierárquico loja → cidade → região → UF.
5. **Preço comparável sempre normalizado** para R$/kg, R$/L ou R$/un. Nunca comparar valor cru.
6. **Veredito usa a faixa típica (mediana/percentis), nunca a média.** Promoção é exibida separada ("menor visto"), nunca colapsada num número único.
7. **Offline obrigatório** para registrar cupom e consultar (cache escopado + delta sync). Dado de preço é minúsculo; sincronização incremental, não download total.
8. **Muro da neutralidade.** O veredito (pool → mediana/faixa) **nunca** é influenciado por quem paga, patrocina ou fornece dados — sem exceção, sem "leve destaque". Preço **anunciado** (catálogo/e-commerce/parceria) jamais entra em `observacao_preco` nem na mediana: vive numa camada **separada e rotulada** como oferta (C12.4). Ver `docs/18-ofertas-e-monetizacao.md`.

> Se uma tarefa parecer exigir violar um destes pontos, **pare e levante a questão** em vez de prosseguir.

---

## Stack (base de trabalho — sujeita a ratificação)
- **App:** React Native + **Expo** + **TypeScript**. Câmera/QR via `expo-camera`. Atualização OTA via EAS Update.
- **Backend:** **PostgreSQL** (Supabase para começar). Parsers SEFAZ e agregações estatísticas como funções/jobs.
- **Banco local (offline):** SQLite no dispositivo (ex.: `expo-sqlite` / Drizzle) para histórico privado + cache de estatísticas.
- **Arquitetura:** app fino (captura + cache + UI) → backend Postgres (parsing por estado + base colaborativa + estatística geo) → cache de volta para o offline.

## Convenções (a valerem quando o código começar)
- TypeScript em todo lugar; tipos compartilhados entre app e backend quando possível.
- Nomes de domínio em **português** (ex.: `produto_canonico`, `observacao_preco`); código/identificadores técnicos em inglês quando for idioma do framework.
- Nada de segredos no repositório; usar variáveis de ambiente.
- Toda escrita no banco compartilhado passa pela camada de anonimização — sem exceção.
- Testes acompanham a feature (ver agente de QA).
- Commits seguem o padrão semântico em PT-BR de `docs/09-padrao-commits.md` (agente `git-committer`).

## Ambiente
- SO de desenvolvimento: Windows 11. Shell primário: PowerShell (o Bash POSIX também está disponível).
- Repositório ainda **não** versionado em git — sugerido `git init` antes do primeiro commit de código.

---

## Skills instaladas — USE SEMPRE QUE FOR PERTINENTE

Estas skills já estão instaladas neste ambiente. Elas **não são opcionais quando o assunto bate**: antes de começar
qualquer tarefa, confira se alguma cobre o tema e **invoque a skill antes de agir** (ela carrega instruções
específicas que substituem o "jeito padrão" de fazer). Não é preciso pedir autorização para usar uma skill.
Se a tarefa cruzar mais de uma área, use mais de uma.

### Do projeto
| Skill | Use quando… |
| --- | --- |
| `graphify` | Qualquer pergunta sobre o código, arquitetura, "onde fica X", "quem chama Y". **Obrigatória antes de ler arquivo-fonte** (ver seção graphify abaixo) e depois de alterar código (`graphify update .`). |
| `supabase` | Qualquer coisa de Supabase: banco, Auth/RLS/JWT/sessão, Edge Functions, Realtime, Storage, Cron, Queues, `supabase-js`, CLI, migrações, auditoria de segurança. |
| `supabase-postgres-best-practices` | Escrever, revisar ou otimizar SQL, esquema, índices e consultas Postgres — inclusive as agregações de `preco_estatistica` e as consultas geográficas. |

### De qualidade e entrega
| Skill | Use quando… |
| --- | --- |
| `code-review` | Ao terminar uma etapa (`C…`) ou antes de commitar mudança relevante: revisão de bugs e limpeza no diff atual. (`/code-review ultra` é pago e **só** quando o dono pedir.) |
| `security-review` | Antes de fechar qualquer etapa que toque autenticação, dados do usuário, chaves, endpoints públicos ou o banco compartilhado — junto com o gate do agente `privacy-lgpd-specialist`. |
| `simplify` | Depois que a feature funciona e o código ficou repetitivo ou inchado. Só qualidade — não caça bugs. |
| `run` | Sempre que a resposta certa for "mostrar funcionando no app de verdade", não só teste passando (rodar/abrir o app, tirar screenshot, confirmar a tela). |
| `claude-api` | Qualquer pergunta ou código envolvendo Claude/Anthropic (modelos, preço, limites, tool use, cache). Nunca responder de memória. |

### De apresentação
| Skill | Use quando… |
| --- | --- |
| `dataviz` | **Antes** de escrever a primeira linha de qualquer gráfico, painel de números, medidor ou visualização — inclusive dentro de `painel/`. |
| `artifact-design` · `artifact-diagramming` · `artifact-capabilities` | Ao publicar uma página/Artifact (relatório visual, diagrama, página com dado ao vivo). |

### De configuração do ambiente
| Skill | Use quando… |
| --- | --- |
| `update-config` | Pedidos de automação ("toda vez que X, faça Y" = hook), permissões, variáveis de ambiente, `settings.json`. |
| `fewer-permission-prompts` | Quando os pedidos de permissão estiverem atrapalhando o fluxo. |
| `keybindings-help` | Atalhos de teclado do Claude Code. |
| `loop` · `schedule` | Tarefa recorrente / agendada (acompanhar deploy, rodar checagem periódica). Nunca para tarefa única e imediata. |

> Regra de ouro: skill pertinente **não usada** conta como trabalho incompleto. Na dúvida entre usar e não usar, use.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
