# 17 — Fontes de catálogo externo (C11.5 / C12.4)

Matriz de plataformas dos mercados e o que dá para coletar de cada um. Base da
config `REDES_VTEX` (enriquecimento) e do futuro C12.4 (ofertas por loja).

> **Descoberta-chave (jul/2026):** nem todo mercado grande é VTEX de catálogo
> aberto. Só quem expõe `/api/catalog_system/pub/products/search` sem bloqueio é
> consultável pelo adaptador VTEX atual.

## Matriz (sondagem de jul/2026)

| Mercado | Plataforma | Catálogo público? | Situação |
|---|---|---|---|
| **Zona Sul** | VTEX | ✅ aberto | Em uso — validado |
| **Prezunic** | VTEX | ✅ aberto | Em uso — validado |
| **Mambo** | VTEX | ✅ aberto | Em uso (SP) — validado |
| **Hortifruti** | VTEX | ✅ aberto | Em uso — validado |
| **Carrefour** | VTEX | ⚠️ bloqueado | É VTEX, mas o endpoint volta 503/403 (anti-bot Cloudflare). Contornar exigiria proxy/headless — frágil e contra a política de polidez. Fora por ora. |
| **Guanabara** | Não-VTEX | ❌ | E-commerce próprio (`smguanabaraonline.com.br`) sem endpoint VTEX. Exigiria adaptador próprio. |
| **Assaí** | Não-VTEX | ❌ | Site institucional; sem catálogo VTEX aberto. Compra via app próprio. |
| **Dom Atacadista** | WordPress + app | ❌ | Site só institucional/encarte (`domatacadista.net`). Catálogo só no app próprio; sem API estruturada — inviável sem OCR de encarte. |

## Enriquecimento (C11.5) NÃO depende do mercado específico

Nome, marca, foto e categoria são atributos GLOBAIS do EAN — o mesmo arroz tem o
mesmo EAN e o mesmo nome em qualquer rede. Para ENRIQUECER um produto, basta que
**qualquer** catálogo grande conheça o EAN. As 4 redes VTEX ativas já cobrem a
grande maioria dos EANs de mercearia do Brasil; adicionar mais redes VTEX amplia
a cobertura de EANs raros, não "traz aquele mercado".

## Preço por loja (C12.4) DEPENDE do mercado específico

Aí sim importa ter a rede X: o preço é por CNPJ de loja. Só é viável nas redes de
catálogo aberto (as 4 acima + Prezunic). Para os não-VTEX (Guanabara, Assaí,
Dom), seria necessário um adaptador por plataforma — cada um implementando a
porta `FonteCatalogo` (`backend/src/fontes/vtex/tipos.ts`), que já é genérica
justamente para isso. Dom (só encarte) provavelmente fica de fora até haver API.

## Como validar um domínio novo

Abra no navegador (ou `curl`):
`https://<dominio>/api/catalog_system/pub/products/search?ft=arroz`
- **HTTP 200/206 + JSON com `productName` e `items[].ean`** → é VTEX aberto: só
  adicionar a `REDES_VTEX`.
- **404 / 403 / 503 / HTML** → não é VTEX aberto: precisa de outro adaptador.
