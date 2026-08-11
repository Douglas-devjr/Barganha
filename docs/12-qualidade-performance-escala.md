# 12 — Qualidade, Performance & Escala (Camada C9)

Camada **transversal**: acompanha todas as outras. Reúne o que garante que o Barganha **funciona, é seguro e escala**. Complementa `04-privacidade-lgpd.md` (a regra) e `06-comparacao-estatistica.md` (a inteligência) com o lado de **execução**.

---

## C9.1 — Pirâmide de testes

Testes acompanham a feature; rodam no CI (`.github/workflows/ci.yml`) a cada push/PR. Stack: **Vitest** (`vitest run`), adaptadores **em memória** (sem Postgres nem rede) para o domínio ficar testável e rápido.

| Nível | Onde | O que cobre |
|---|---|---|
| **Unitário** | `shared/`, núcleos puros (`agregacao`, `faixa`, `veredito`, `normalizacao`, `escopos`, `casamento-texto`) e o **gate** (`gate.test.ts`) | regras isoladas, sem efeitos colaterais |
| **Integração** | `processamento/fluxo.test.ts`, `ingestao/`, `consulta/`, `sync/`, parsers por UF com **fixtures** (`__fixtures__/*.html`) | costura de 2+ peças (parse → anonimização → pool; pipeline → consulta) |
| **Contrato** | `persistencia/repositorio-supabase.test.ts` | trava a forma da escrita transacional (RPC `processar_cupom`) sem subir banco |
| **e2e (jornada)** | `http/jornada.e2e.test.ts` | C2→C3→C4 ponta a ponta pela borda HTTP: conta → ingestão → pipeline → consulta → sync |

**Fixtures de cupom.** Hoje há um cupom modelo por estado com layout realista (RJ/SP), incluindo uma linha de **CPF de propósito** para provar que o parser a ignora. **A fazer (QA, contínuo):** substituir/ampliar por capturas **reais** anonimizadas conforme novos layouts aparecem (portais mudam — `03-captura-nfce-sefaz.md`).

---

## C9.2 — Gate LGPD automatizado + re-identificação

A privacidade é garantida pela **arquitetura** (`04`), e o CI a verifica em três camadas:

1. **Compilação** — `SemDadoPessoal<T>` (em `shared/anonimizacao/gate.ts`) faz a saída colapsar para `never` se um campo proibido (`usuarioId`, `cupomId`, `chaveAcesso`, `cpf`, `nome`) for adicionado: **quebra o build**.
2. **Runtime** — `garantirSemDadoPessoal()` é a última trava **antes de toda escrita no pool** (chamada em `repositorio-supabase` e `repositorio-memoria`). A persistência fala JSON/RPC, onde o tipo se perde; esta checagem **aborta** se algo escapou.
3. **e2e** — `jornada.e2e.test.ts` audita o pool **depois** da jornada inteira e prova:
   - nenhuma observação tem campo pessoal nem vínculo de cupom/usuário (só as 8 colunas de preço permitidas);
   - `observado_em` é **granular ao dia** (não dá para ordenar a cesta por horário);
   - **cesta dissolvida** — sem discriminador por cesta, vários cupons colapsam no mesmo contexto `(loja, dia)`, então não há como reconstruir "estes itens juntos".

> Checklist de re-identificação (rodar em toda PR que toca dados): ver o gate de `04-privacidade-lgpd.md`.

---

## C9.3 — Performance (índices/EXPLAIN) + plano de escala

### Caminhos quentes e os índices que os cobrem
Definidos em `supabase/migrations/`. Cada consulta de leitura tem um índice que a lidera:

| Caminho | Consulta | Índice |
|---|---|---|
| Idempotência do upload | `cupom` por `(usuario_id, chave_acesso)` | `cupom_usuario_chave_uniq` (parcial) |
| Pipeline (C3.1) | observações de um produto | `observacao_preco_geo_idx` / `_produto_tempo_idx` |
| Recálculo incremental (F1) | observações por **inserção** | `observacao_preco_criado_idx` |
| Consulta de preço (C4.1) | `preco_estatistica` por produto × escopo | PK `(produto, escopo, escopo_id, unidade_base)` |
| Delta sync por região (C4.2) | `(escopo_id, atualizado_em)` | `preco_estatistica_escopo_atualizado_idx` |
| Delta sync por produto (C4.2) | `(produto_canonico_id, atualizado_em)` | `preco_estatistica_produto_atualizado_idx` |
| Busca por nome (C4.1) | `descricao_normalizada ILIKE '%token%'` | GIN `pg_trgm` (`..._descricao_trgm_idx`) |

**Protocolo de afinação.** Antes de mexer em índice, medir: `EXPLAIN (ANALYZE, BUFFERS)` na consulta real com dados de volume. Adicionar índice só com evidência (sequential scan custoso no caminho quente). Toda migration de índice usa `create index if not exists` (idempotente).

### Ingestão transacional (C9.3.1) — **feito**
`marcarProcessado` agora delega a uma **função SQL única** (`processar_cupom`), rodando loja + itens privados + pool + status numa só transação. Elimina a janela em que uma falha parcial após inserir no pool **duplicaria** observações no retry da fila.

### Anti-abuso (C9.3.2) — **feito**
Rate-limit por janela fixa: teto na **criação de conta** (por IP), na **leitura pública** consulta+sync (por IP, orçamento somado), nos **endpoints privados** (por IP antes de autenticar e por **conta** depois) e na **curadoria** (por IP). Por trás de proxy, habilitar `trustProxy` para o IP ser o do cliente.

Duas implementações atrás da mesma interface `Limitador`: `LimitadorJanelaFixa` (memória, `http/rate-limit.ts`) e `LimitadorJanelaFixaPostgres` (`http/limitador-postgres.ts`), escolhidas em `servidor.ts` pela presença de `supabaseClient`. Em produção vale a de Postgres — com o contador em memória, subir uma segunda instância **dobrava silenciosamente todos os tetos**.

Três propriedades que o store compartilhado exige e que a primeira versão não tinha (migração `20260809090000_rate_limit_atomico`):

- **Contagem atômica.** `consumir_rate_limit` incrementa e decide num único `insert ... on conflict do update ... returning`. Ler e depois gravar em duas chamadas REST deixava requisições concorrentes lerem a mesma contagem — o teto vazava proporcionalmente ao flood, ou seja, falhava exatamente no caso que existe para conter.
- **Escopo na chave.** Quatro dos cinco limitadores chaveiam por `req.ip` e dividem a tabela; sem prefixo por escopo, o mesmo IP consultando preço e criando conta caía numa linha só. Em memória o problema não existia (um `Map` por instância), por isso nasceu junto com a versão compartilhada.
- **Poda pelo `janela_ms` da própria linha.** A limpeza apagava tudo mais velho que a janela de *quem* podava: o limitador de leitura (1 min) zerava, a cada minuto, as janelas do de conta (1 h) — e 20 contas/hora viravam 20 contas/minuto.

**Degradação.** O limitador roda no `onRequest`; uma exceção ali viraria 500 em todas as rotas. Com o banco fora, `LimitadorJanelaFixaPostgres` registra o erro e responde pelo contador em memória: o teto volta a valer por processo enquanto durar a falha, em vez de o Postgres derrubar consulta e sync junto.

### Plano de escala
O dado de preço é **minúsculo** e a carga é de leitura. A ordem de evolução, quando o volume pedir:

1. **Pipeline incremental** (já é por inserção): manter o recálculo só dos produtos com observação nova; nunca recomputar a base toda.
2. **Delta sync** (já é o modelo): o app baixa só o que mudou desde o cursor, escopado à sua região/produtos — não há download total.
3. ~~**Rate-limit distribuído**~~ — **feito** (C9.3.2): o contador vive em `rate_limit_janela` e vale para a frota inteira, sem dependência nova (o Postgres que já existe). Um Redis só se entrar na conta o custo por requisição do round trip ao banco no caminho quente.
4. ~~**Fila durável**~~ — **feito** (C2.1): a fila é a tabela `fila_processamento` com reivindicação por `for update skip locked` (`fila/fila-postgres.ts`). A `FilaMemoria` continua servindo aos testes e ao dev local (`FILA_DURAVEL=false`), como a raiz de composição sempre previu.
5. **Busca de texto plena**: evoluir o pré-filtro `ILIKE`+trigram para `tsvector`/ranking quando o catálogo crescer.
6. **Particionamento/retenção**: se `observacao_preco` crescer muito, particionar por tempo; o decaimento temporal (`06`) já torna o histórico antigo descartável para o veredito.

---

## C9.5 — Log estruturado e sanitização (C10.2)

**Uma pilha só: Pino.** O Fastify já usa Pino internamente — adotar Winston significaria manter duas bibliotecas no mesmo processo e misturar duas gramáticas no stdout. `fatal` também é nível nativo do Pino (o Winston não o tem por padrão). Custo: zero dependência nova.

- **Backend:** `backend/src/observabilidade/log.ts`. `log` (aplicação) e `opcoesLogFastify` (HTTP) compartilham a MESMA configuração e a mesma máscara.
- **App:** `app/src/nucleo/log.ts` — módulo próprio (o React Native não tem as streams do Node). Mesmos níveis, mesmos campos, **silencioso em release**.

### Níveis — a política que evita alerta-ruído
| Nível | Quando | Exemplo |
|---|---|---|
| `info` | Marco de negócio | cupom processado, job concluído, boot |
| `warn` | Degradação **com** recuperação automática | retentativa da fila, portal recusando |
| `error` | Exige ação humana; usuário afetado | falha permanente de parser, telemetria não persistindo |
| `fatal` | Processo inutilizável | config ausente, `listen` falhou |

> Erro **transitório que a fila vai reprocessar é `warn`, não `error`.** Se toda oscilação de portal da SEFAZ virasse `error`, o alerta seria desligado na primeira semana — e um alerta desligado não protege nada.

### Sanitização — duas camadas, porque nenhuma basta sozinha
1. **`redact` do Pino** — campos *nomeados* (`req.headers.authorization`, `*.token`, `*.cpf`, `*.chaveAcesso`, `*.html`). A sintaxe de `paths` **falha em silêncio** se estiver errada, por isso é testada em `backend/src/observabilidade/log.test.ts`.
2. **`sanitizarErro` / `redigirTexto`** (`@barganha/shared`, usado por app e backend) — dado pessoal embutido em **texto livre**, que o `redact` não enxerga. Testado em `shared/src/observabilidade/redacao.test.ts`.

**Regras invioláveis:**
- Nenhum erro vai ao log cru — sempre `sanitizarErro(erro)`. Vale também para texto **persistido**: `marcarFalha(cupomId, motivo)` grava no banco, então o `motivo` passa pela redação antes.
- **Nunca interpolar texto raspado do portal** numa mensagem de erro. Esses erros disparam justamente quando um seletor *derrapou* — e o elemento errado pode ser o bloco do consumidor, com CPF. Descreva a **forma** (`len=`, tem dígitos), não o conteúdo. Para inspecionar layout existe o esqueleto de `debug-html.ts`.
- **Proibido logar `usuarioId` no caminho do POOL** (`observacao_preco`). Os dois lados juntos reconstruiriam por log o vínculo usuário↔compra que a decisão travada nº3 proíbe no banco. No lado privado (ingestão, conta) o vínculo já existe e pode ser logado.
- **CNPJ da loja NÃO é redigido** — é dado de empresa, já persistido por projeto (geo pela loja, decisão travada nº4), e é o que permite diagnosticar divergência nota × chave.

### Correlação
`cupomId` é a chave que atravessa ingestão → fila → parsing → pool, três fronteiras assíncronas onde o `reqId` do Fastify já morreu. Use `logDeCupom(cupomId, uf)`; no HTTP, a rota entra como `action` (com template, nunca a URL concreta — id vira cardinalidade infinita).

---

## C9.4 — Política de privacidade
Publicada em `docs/politica-de-privacidade.md` (texto ao usuário, derivado de `04`). O fluxo de consentimento no onboarding é C6.4.
