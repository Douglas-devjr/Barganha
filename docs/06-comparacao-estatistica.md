# 06 — Comparação & Estatística

## Objetivo
Dado um produto e um preço de prateleira, responder: **barato / na média / caro** — de forma confiável, robusta a promoções e a outliers, e relevante para a **região** do usuário.

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

Mostrar **dois ângulos** quando houver dado: *vs. esta loja* e *vs. a região*.

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
