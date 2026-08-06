# 06 — Comparação & Estatística

> **v1 implementado** na Camada 3 (C3). Núcleo puro e testável:
> - **Veredito** (compartilhado, usado offline pelo app): `shared/src/estatistica/veredito.ts` — `classificarPreco`, `montarVeredito` (híbrido pessoal+regional), linha de promoção à parte.
> - **Agregação** (C3.1/C3.2/C3.6): `backend/src/estatistica/agregacao.ts` — mediana/percentis **ponderados**, decaimento temporal por meia-vida, detecção de promoção (flag NFC-e + cerco IQR).
> - **Escopos + fallback** (C3.3): `backend/src/estatistica/escopos.ts`.
> - **Casamento por texto** (C3.5): `backend/src/estatistica/casamento-texto.ts` (só **sugere**; confirmação é curadoria).
> - **Pipeline** (C3.1): `backend/src/estatistica/pipeline.ts` grava `preco_estatistica`. EAN (C3.4) já casa na ingestão (C2).
> - **Normalização** (fonte única app+backend): `shared/src/estatistica/normalizacao.ts` — `normalizarPreco` (R$/kg·L·un pelo preço unitário), `resolverUnidade`/`itensPorEmbalagem` (multipack, C3.4) + `unidadePadraoDaBase`. O backend só re-exporta.
>
> **v1 da gôndola implementado** na Camada 7 (C7), consumindo o núcleo acima:
> - **Faixa pessoal** (C7.2): `shared/src/estatistica/faixa.ts` — `montarFaixaDeObservacoes` (mediana/percentis não ponderados sobre o histórico privado; promoção à parte).
> - **Veredito local** (C7.2/C7.3): `app/src/nucleo/veredito-local.ts` resolve o híbrido do cache offline e refina online; `app/src/nucleo/catalogo.ts` agrega o histórico em produtos. Tela `Verificar` (scan de barras + busca), `Produtos` e `Detalhe` (evolução 6 meses).
> - **Cache offline** (C7.2): o delta sync (`app/src/nucleo/sincronizador.ts → sincronizarEstatisticas`) alimenta `cache_estatistica` no nível de UF (município quando houver).
>
> Limiares (meia-vida, mínimos de `n`, limiar de similaridade, cerco de promoção) ficam em constantes marcadas **a calibrar com dados reais** — ver a seção final.

## Objetivo
Dado um produto e um preço de prateleira, responder: **barato / na média / caro** — de forma confiável, robusta a promoções e a outliers, e relevante tanto ao **histórico do usuário** quanto à **região**.

## Como o veredito é montado (decisões reconciliadas com o protótipo)
O veredito combina **dois mundos**, exibidos juntos na tela "Verificar":
1. **Seu histórico** (pessoal): o que *você* costuma pagar — seu típico, seu menor preço, em qual mercado.
2. **Sua região** (colaborativo/anônimo): o típico, a faixa e o menor visto na sua cidade — o diferencial do Barganha, que dá valor mesmo a quem nunca comprou o item.

Quando o usuário ainda não tem histórico de um produto, o veredito usa só a região; conforme ele compra, o ângulo pessoal aparece ao lado.

**Entrada do produto** na tela "Verificar": **código de barras (caminho principal)** + **busca por nome (fallback)**.

**Importante:** a estatística (dos dois mundos) usa **mediana e percentis**, nunca média — inclusive na UI o rótulo é "típico", não "médio" (ajuste em relação ao protótipo, que usava média ±5%).

## Normalização (pré-requisito)
Todo preço é convertido para a **unidade base** do produto: **R$/kg**, **R$/L** ou **R$/un**, usando a `unidade` e a `quantidade` da NFC-e. Nunca se compara valor cru.

**Embalagem (C3.4).** As unidades entram em três grupos:
- **Fator fixo** — `KG`/`G`, `L`/`ML`, `UN`, `DZ`: conversão direta.
- **Um volume = um item vendido** — pacote, saco, bandeja, pote, frasco, garrafa, lata, vidro, tubo, rolo: valem como `UN`.
- **Embalagem múltipla** — `CX`, `FD`, `PACK`, `DP`: o fator depende de **quantas unidades vêm dentro**, então só normaliza quando a contagem é declarada, na própria unidade (`CX12`) ou na descrição (`12X350ML`, `FD 6`, `C/12`, `30UN`). O preço vira **R$/un do item de dentro** — o que compara com o mesmo produto vendido solto, caso comum nos portais **sem EAN** (RJ/ENCAT), onde caixa e unidade caem no mesmo canônico pela descrição.

Sem contagem declarada, o item **fica fora do pool** (segue no histórico privado): "R$ 36 a caixa" entrando na mediana da lata é pior que observação nenhuma. Um número que pareça **tamanho** não é aceito como contagem (`CX 5KG` = uma caixa de 5 kg, não 5 unidades), e `KIT`/`CONJUNTO` nunca são divididos — o conteúdo é heterogêneo.

A descrição serve **só** para ler essa contagem: ela nunca altera o fator de uma unidade de fator fixo. Por isso, se um dos lados (app ou backend) esquecer de passá-la, o efeito é uma observação **a menos**, nunca um preço **diferente**.

Normalizar pelo **tamanho** do pacote (R$/kg de um `ARROZ 5KG` vendido por `UN`) é outra coisa, e fica para C11.5.

## A estatística usa MEDIANA, nunca média
A média é sensível a outliers e a promoções. Usamos:
- **Mediana** → o "típico".
- **p25 / p75** → a faixa "normal".
- **mínimo / máximo** → extremos.
- **menor_promocional** → o menor preço marcado como promoção (exibido à parte).
- **n_observacoes** → confiança (quando baixo, sinalizar incerteza).

## Tratamento de promoção (3 camadas)
1. **Sinal da própria NFC-e:** quando há campo de **desconto** no item, ele é marcado como `em_promocao = true` automaticamente.
2. **Detecção estatística:** preços bem abaixo do p25 formam um "cacho" promocional → segregados do cálculo do típico.
3. **Exibição separada (a correção de verdade):** **nunca** um número único. Sempre:
   > Típico: **R$ 8,00** · Menor visto: **R$ 5,00** (promoção, há 2 semanas)

   O veredito compara o preço da prateleira contra a **faixa regular** (p25–p75), não contra o menor promocional. Isso evita a reclamação de "o mercado está roubando" quando, na verdade, o R$ 5,00 era uma promoção pontual.

## Peso temporal
Preços recentes valem mais que antigos (inflação). Aplicar **decaimento temporal** (ex.: meia-vida de algumas semanas) ao agregar — uma observação de 8 meses atrás pesa muito menos que uma de 2 semanas.

## Geolocalização & fallback hierárquico
A comparação é **regional** (preço varia muito por município). Ao consultar:
1. tenta no escopo **loja** → se `n_observacoes` insuficiente,
2. sobe para **município** → depois **região** → depois **UF**.

O nível **loja** tem ainda um **piso de exposição** (privacidade, docs/04): abaixo de `MIN_OBSERVACOES_EXPOR_LOJA` a célula é suprimida — não é servida, nem sincronizada, nem exibida, e **não** volta como "maior base" no passo 2 (com `n = 1` a mediana da loja é o preço de uma compra específica). Os demais níveis só ganham a ressalva de baixa confiança.

Sempre há resposta, no nível mais específico possível, e a UI informa a base:
> "baseado em 3 mercados na sua cidade"

Mostrar os ângulos disponíveis: *seu histórico*, *vs. esta loja* e *vs. a região*.

## Veredito (exemplo)
> **R$ 7,90/L** — acima do típico (R$ 6,50/L). Já vi por **R$ 5,99/L** no Atacadão há 3 semanas.

A regra tem **dois filtros**, nesta ordem — o veredito só sai quando os dois concordam:

1. **Zona morta (magnitude).** `|preço − mediana| / mediana` precisa passar de **5%**
   (`LIMIARES_VEREDITO.diferencaMinimaRelevante`). Dentro disso é sempre **na média**.
2. **Percentil (direção).** Passou dos 5%: abaixo de p25 → **barato**, acima de p75 →
   **caro**, no meio → **na média**.

### Por que a zona morta existe

O percentil sozinho não tem noção de magnitude — `< p25` é uma **posição**, não uma
diferença. E 25% da população está abaixo do p25 **por definição**, então o rótulo saía
com essa frequência mesmo quando a economia era irrisória.

O tamanho do gap `(mediana − p25)/mediana` depende inteiramente de quanto o produto
varia de preço na região. Simulando a distribuição com a mesma função de percentil do
`agregacao.ts` (mediana do gap, e entre parênteses o décimo percentil — o caso ruim):

| n \ dispersão (CV) | 3% | 5% | 8% | 12% | 20% |
|---|---|---|---|---|---|
| 3 | 1,5% (0,3%) | 2,5% (0,5%) | 4,0% (0,7%) | 6,0% (1,1%) | 9,6% (1,8%) |
| 8 | 1,8% (0,8%) | 3,0% (1,4%) | 4,8% (2,2%) | 7,1% (3,2%) | 11,5% (5,3%) |
| 40 | 2,0% (1,3%) | 3,2% (2,2%) | 5,1% (3,5%) | 7,5% (5,2%) | 12,2% (8,5%) |

Ou seja: o limiar implícito da regra antiga oscilava de **0,3% a 12%** conforme o
produto. Num item homogêneo (refrigerante, onde toda loja cobra quase o mesmo) o app
estampava "BARATO" por R$ 0,10 num item de R$ 8. O problema é **pior com `n` pequeno**,
que é exatamente o regime do pool hoje.

### Por que 5%

Os 5% cercam três coisas ao mesmo tempo:
- **ruído da própria agregação** — janela de 180 dias com inflação de alimento dentro,
  arredondamento da normalização por kg/L, mistura de embalagens;
- **percepção humana** — o limiar de diferença perceptível em preço de mercado fica na
  faixa de 5–10%;
- **relevância prática** — 5% num item de R$ 10 é R$ 0,50; abaixo disso o usuário não
  muda de decisão, e o veredito só gasta credibilidade.

O corte é **cirúrgico**. Fração de vereditos "barato" que a zona morta rebaixa:

| dispersão (CV) | zona 3% | **zona 5%** | zona 7% | zona 10% |
|---|---|---|---|---|
| 3% (homogêneo) | 40% | **79%** | 95% | 100% |
| 5% | 13% | **42%** | 67% | 90% |
| 8% (típico) | 4% | **15%** | 34% | 61% |
| 12% | 1% | **6%** | 13% | 31% |
| 20% (disperso) | 0% | **1%** | 3% | 9% |

A 5% o filtro atinge quase só os produtos homogêneos — onde o veredito era ruído — e
deixa intactos os dispersos, onde era sinal real. A 3% é tímido demais para consertar a
coluna de CV 3–5%; a 7–10% começa a comer sinal legítimo da faixa típica (CV 8%).

### O que deliberadamente NÃO foi feito

Não existe **override por magnitude** (do tipo "≥15% acima da mediana → caro mesmo
dentro do p75"). A falha oposta — "na média" escondendo um preço muito acima do típico —
praticamente não ocorre: 0,1% dos casos com CV 8%, 1,5% com CV 12%. Só aparece em CV 20%
(8,5%), e nessa faixa a dispersão provavelmente denuncia **casamento de produto ruim**
(marcas/tamanhos diferentes no mesmo canônico), não um mercado caro. A correção certa ali
é o casamento, não o veredito.

### A revisitar com dados reais

Hoje o limiar é **simétrico**. Há um argumento para "barato" exigir um gap maior que
"caro": o pool nasce de **compras**, e as pessoas compram mais em promoção, o que puxa a
mediana para baixo. O cerco IQR já segrega as promoções profundas, mas o viés residual é
mensurável — e virar assimétrico é trocar uma constante por duas.

## Economia real (pagou × típico) — planejado, C8.4

Hoje o app soma o **desconto da NFC-e** e chama isso de descontos — corretamente,
porque é o que é: a promoção que o **mercado** deu, idêntica se o Barganha não
existisse. A métrica que mede o *app* é outra: **quanto o usuário pagou a menos
(ou a mais) que o típico da região**. Comprou leite a R$ 10 onde o típico é R$ 15
→ economizou R$ 5.

### O que já está pronto (feito antes da UI, de propósito)
Todo item processado guarda o **snapshot do típico da região no instante da
compra** (`TipicoNaCompra`: mediana, unidade-base, escopo e `n`). Está no
`item_cupom` (migração `20260725090000`) e desce ao espelho local (migração v7).

Foi feito primeiro porque **é a única parte irrecuperável**: `preco_estatistica`
guarda só o estado atual, então a mediana de hoje não existe mais amanhã. Sem o
snapshot, a métrica só teria duas saídas ruins — comparar compra antiga com pool
de hoje (inflação vira economia fantasma, e o número muda sozinho a cada sync) ou
nascer sem histórico. Mesma lógica de guardar o QR cru desde o dia 1.

Duas decisões já embutidas na captura:
- **A mediana é lida ANTES de o cupom entrar no pool** — a base é o típico de
  antes da própria compra do usuário, que não se auto-referencia. A ordem está
  travada por teste em `fluxo.test.ts`.
- **O nível loja é excluído.** Comparar com a mediana da própria loja tende a
  zero e responde "peguei promoção aqui?", não "escolhi bem?". Base é
  município → região → UF.

### O que falta (não construir antes da hora)
Com o pool raso, o snapshot vem vazio para quase todo item e a tela mostraria
"R$ 0,00 · 2 de 40 itens comparados" — uma prova visual de que o app ainda não
tem dados. O gatilho para construir **não é uma data, é cobertura medida**:
quando a fração de itens com `tipico_mediana` não-nula passar de ~60% num cupom
típico. Como o campo já é gravado, dá para medir em vez de chutar.

Quando for a hora, três condições **inegociáveis** — sem elas a métrica é *pior*
que a atual, porque troca um número chato e verdadeiro por um bonito e não
auditável:

1. **Pode dar negativo.** Somar só os itens abaixo do típico infla o número
   sistematicamente e vira métrica de vaidade. É um **saldo líquido**: às vezes
   "R$ 32 abaixo do típico", às vezes "R$ 14 acima". Boletim, não troféu.
2. **Declara a cobertura.** "23 de 41 itens comparados" — com dados sem EAN,
   boa parte não casa. Um número parcial se passando por total é mentira por
   omissão. E o piso de `n` para *afirmar* economia deve ser maior que o
   `minObservacoesConfiavel` (3) usado no veredito da gôndola: 3 observações
   servem para uma opinião com ressalva, não para "você economizou R$ 5,00".
3. **Drill-down obrigatório.** O desconto do cupom é auditável (está no papel);
   este número é uma afirmação do app. Cada real precisa ser rastreável até
   "Leite 1L · pagou R$ 5,49/L · típico R$ 6,90/L · 12 observações no município".

Duas notas de cálculo:
- **Não somar as duas métricas.** O preço pago já é líquido do desconto. A
  decomposição exata é `típico − pago = (típico − bruto) + desconto`: "destes
  R$ 32, R$ 12 vieram de promoções do mercado e R$ 20 de escolher onde e o quê
  comprar" — a segunda parcela é o valor do app.
- **Fallback de cobertura zero:** enquanto não há base, o card assume ("ainda
  juntando base na sua região") e mostra o desconto do cupom como stat
  secundário — nunca R$ 0,00 sem explicação.

Também fica para essa hora a **renomeação dos identificadores** (`economiaPorMes`,
`EconomiaMensal`, `economia_total`…), que hoje dizem "economia" mas somam
desconto. Renomear agora seria churn; renomear quando as duas métricas
coexistirem é necessário.

## Casamento de produtos

**Ordem única de resolução** (`backend/src/anonimizacao/resolvedor-produto.ts`),
compartilhada pela ingestão (C2) e pelo backfill (`job:republicar`):

| # | Caminho | Cria canônico? |
|---|---|---|
| 0 | **EAN real** — identidade global, a mais forte que existe | sim (acha-ou-cria) |
| 1 | **(loja_cnpj, código interno)** — SKU estável DENTRO daquela loja | **não** |
| 2 | **`produto_alias` confirmado** — decisão humana sobre um texto | não |
| 3 | **descrição normalizada exata** — o último recurso | sim (acha-ou-cria) |

**Invariante do passo 1** (não negociável): o mapeamento `(loja, código)` é
**cache de uma decisão tomada por um caminho igual ou mais forte** — só nasce
de 0, 2 ou 3, e **nunca cria** `produto_canonico`. Sem isso, a chave viraria
porta lateral para casar por similaridade sem confirmação.

**Por que o passo 1 existe.** Não é economia de CPU (o passo 3 já é um SELECT
indexado). Para item sem EAN, a identidade do produto **era** a string exata:
qualquer mudança de escrita no PDV (abreviação nova, "PROMO" no nome, troca de
sistema) criava um canônico novo e **partia a série de preço em duas, em
silêncio** — a mediana voltava a `n=1` e o veredito seguia exibindo número com
cara de confiança. Evidência de que a chave é estável: dois cupons da mesma
loja, mesmo item, mesmo código interno.

**Guardas do passo 1** (o código pode ser reciclado pela loja depois de
descontinuar o item antigo):

| Guarda | Regra | Ação |
|---|---|---|
| Unidade-base | `mapeamento.unidadeBase ≠ item.unidadeBase` | **veto duro** |
| Similaridade | `≥ 0,55` (linha `ativo`) ou `≥ 0,65` (`suspeito`/`dormente`/herdada da rede) | abaixo: não usa, marca e cai para o passo seguinte |
| Salto de preço | fora de `[1/3, 3] ×` a âncora | **só sinaliza**, nunca veta |

Faixa de dúvida (`0,35 ≤ s < 0,55`) **com** salto de preço = `reuso_provavel`,
a assinatura do SKU reciclado. Recusa **nunca reaponta** o canônico sozinho —
marca a linha para a curadoria e degrada para o passo 3. Um uso aceito devolve
a linha a `ativo`, então uma descrição estranha isolada se corrige sem humano.

- **Sem EAN** (hortifruti/padaria/açougue): a **similaridade** continua sendo só
  **sugestão** (`POST /curadoria/casamento/sugestoes`), confirmada pelo
  usuário/curadoria antes de virar referência — nunca casa sozinha.
- **Fragmentação** (mesmo produto em dois canônicos): resolvida pela **fusão**
  (`POST /curadoria/produto/fundir`), que reaponta pool, histórico privado,
  aliases, mapeamentos, alertas e denúncias numa transação, e grava o alias da
  descrição do perdedor — sem esse alias a fusão se desfaz no cupom seguinte.
  Recusa quando a intenção é ambígua (unidades diferentes, dois EANs distintos,
  perdedor com o único EAN) em vez de adivinhar: não há desfazer.

## Qualidade e abuso
- Mediana + decaimento temporal já absorvem boa parte de erros e outliers.
- `n_observacoes` baixo → exibir com ressalva ("poucos dados ainda").
- Quando entrar lançamento manual de gôndola (fase futura), reforçar moderação e detecção de anomalia.

## A calibrar com dados reais (responsável: data-scientist)
- Zona morta por categoria (hoje global em 5%) e possível assimetria barato/caro.
- Meia-vida do decaimento temporal.
- Mínimo de `n_observacoes` por nível de escopo.
- Heurística de detecção de promoção sem campo de desconto.
- **Guardas da chave (loja, código)** — `LIMIARES_CODIGO_LOJA` em
  `backend/src/anonimizacao/resolvedor-produto.ts`. Os valores de hoje (0,55 /
  0,35 / 0,65 / fator 3 / 548 dias) são **chute fundamentado, não calibração**.
  Como medir, quando houver volume: (a) **canônicos distintos por `(loja,
  código)`** deve ficar ≈ 1,0 — é a medida direta de a chave estar funcionando;
  (b) **cobertura** = % de itens sem EAN resolvidos pelo passo 1 (platô muito
  abaixo de ~70% em lojas recorrentes = o código não é tão estável quanto
  parece); (c) **taxa de suspeita** = linhas marcadas / hits, alvo < 1–2%;
  (d) **fragmentação** = nº de canônicos com descrição ≥ 0,8 de similaridade e
  mesma unidade-base, antes/depois da fusão.
- **Herança de código entre filiais da mesma rede** (`alargarPorRede`, hoje
  **desligada**). A hipótese é que filiais com a mesma raiz de CNPJ compartilhem
  o ERP e portanto o código. Contra-prova antes de ligar: por `codigo`, contar
  raízes distintas; entre as com ≥ 2, comparar descrições. Discordância alta
  entre raízes confirma a chave por CNPJ completo; concordância alta **dentro**
  da mesma raiz valida o alargamento.
- Abreviações de unidade por portal: o que não está no mapa fica fora do pool **em silêncio**. Contar as unidades recusadas na ingestão diz quais faltam.

### Ferramenta de calibração (já pronta; falta é volume do beta)

Os três primeiros itens acima (meia-vida, cerco IQR, mínimo de `n` por nível) já
têm uma **ferramenta de medição**: `backend/src/estatistica/calibracao.ts` +
o job `npm run job:calibracao` (workspace `@barganha/backend`). Ela não decide
nada sozinha — só mede o pool real e recomenda; aplicar a recomendação
(trocar `DECAIMENTO` ou `MIN_OBSERVACOES_FALLBACK`) continua sendo um commit
humano separado, como qualquer outra mudança de comportamento do veredito.

Método de cada medição:
- **Meia-vida:** backtest walk-forward por grupo (produto × unidade × escopo) —
  esconde a fatia final do tempo, calcula a mediana ponderada só com o
  passado e mede o erro percentual contra o futuro escondido, para cada
  meia-vida candidata. Vence a de menor erro agregado.
- **Fator do cerco de promoção:** usa a flag `emPromocao` da própria NFC-e
  (camada 1) como ground truth. Para cada `k` candidato, mede recall (quantas
  promoções declaradas o cerco também pegaria) e falso-positivo (quanto preço
  regular seria segregado por engano) e recomenda o menor `k` que atinge um
  recall-alvo sem estourar o teto de falso-positivo.
- **Mínimo de observações por nível:** bootstrap dentro de cada nível de
  escopo — reamostra grupos com pool grande e mede o quanto a mediana
  estimada balança em função de `n`; recomenda o menor `n` que estabiliza
  abaixo de uma amplitude relativa alvo. Por nível porque a dispersão de
  preço cresce com a amplitude geográfica (loja ≠ UF).

Enquanto o pool do beta for raso, o job reporta honestamente "dados
insuficientes" em vez de inventar número — a calibração de verdade só
acontece quando alguém rodar o job com volume real e decidir aplicar (ou
não) o que ele recomendar.
