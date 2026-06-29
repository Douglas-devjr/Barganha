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
Rate-limit por janela fixa (`http/rate-limit.ts`), em processo: teto na **criação de conta** (por IP) e na **leitura pública** consulta+sync (por IP, orçamento somado); ingestão por conta (Bearer). Por trás de proxy, habilitar `trustProxy` para o IP ser o do cliente.

### Plano de escala
O dado de preço é **minúsculo** e a carga é de leitura. A ordem de evolução, quando o volume pedir:

1. **Pipeline incremental** (já é por inserção): manter o recálculo só dos produtos com observação nova; nunca recomputar a base toda.
2. **Delta sync** (já é o modelo): o app baixa só o que mudou desde o cursor, escopado à sua região/produtos — não há download total.
3. **Rate-limit distribuído**: ao rodar mais de uma instância (C10), trocar o store em memória do limitador por um compartilhado (ex.: Redis), mantendo a interface `LimitadorJanelaFixa`.
4. **Fila durável**: a `FilaMemoria` é suficiente para o MVP; sob volume, mover para fila persistente (a raiz de composição isola a troca).
5. **Busca de texto plena**: evoluir o pré-filtro `ILIKE`+trigram para `tsvector`/ranking quando o catálogo crescer.
6. **Particionamento/retenção**: se `observacao_preco` crescer muito, particionar por tempo; o decaimento temporal (`06`) já torna o histórico antigo descartável para o veredito.

---

## C9.4 — Política de privacidade
Publicada em `docs/politica-de-privacidade.md` (texto ao usuário, derivado de `04`). O fluxo de consentimento no onboarding é C6.4.
