# 06 — Comparação & Estatística

> **v1 implementado** na Camada 3 (C3). Núcleo puro e testável:
> - **Veredito** (compartilhado, usado offline pelo app): `shared/src/estatistica/veredito.ts` — `classificarPreco`, `montarVeredito` (híbrido pessoal+regional), linha de promoção à parte.
> - **Agregação** (C3.1/C3.2/C3.6): `backend/src/estatistica/agregacao.ts` — mediana/percentis **ponderados**, decaimento temporal por meia-vida, detecção de promoção (flag NFC-e + cerco IQR).
> - **Escopos + fallback** (C3.3): `backend/src/estatistica/escopos.ts`.
> - **Casamento por texto** (C3.5): `backend/src/estatistica/casamento-texto.ts` (só **sugere**; confirmação é curadoria).
> - **Pipeline** (C3.1): `backend/src/estatistica/pipeline.ts` grava `preco_estatistica`. EAN (C3.4) já casa na ingestão (C2).
> - **Normalização** (fonte única app+backend): `shared/src/estatistica/normalizacao.ts` — `normalizarPreco` (R$/kg·L·un pelo preço unitário) + `unidadePadraoDaBase`. O backend só re-exporta.
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

Sempre há resposta, no nível mais específico possível, e a UI informa a base:
> "baseado em 3 mercados na sua cidade"

Mostrar os ângulos disponíveis: *seu histórico*, *vs. esta loja* e *vs. a região*.

## Veredito (exemplo)
> **R$ 7,90/L** — acima do típico (R$ 6,50/L). Já vi por **R$ 5,99/L** no Atacadão há 3 semanas.

Faixas sugeridas (a calibrar com dados reais):
- abaixo de p25 → **barato**
- entre p25 e p75 → **na média**
- acima de p75 → **caro**

## Casamento de produtos
- **Com EAN:** casamento direto ao `produto_canonico`.
- **Sem EAN** (hortifruti/padaria/açougue): casamento por **texto** (normalização + similaridade) gerando `produto_alias` com score, **confirmado** pelo usuário/curadoria antes de virar referência.

## Qualidade e abuso
- Mediana + decaimento temporal já absorvem boa parte de erros e outliers.
- `n_observacoes` baixo → exibir com ressalva ("poucos dados ainda").
- Quando entrar lançamento manual de gôndola (fase futura), reforçar moderação e detecção de anomalia.

## A calibrar com dados reais (responsável: data-scientist)
- Limiares exatos de barato/caro por categoria.
- Meia-vida do decaimento temporal.
- Mínimo de `n_observacoes` por nível de escopo.
- Heurística de detecção de promoção sem campo de desconto.
