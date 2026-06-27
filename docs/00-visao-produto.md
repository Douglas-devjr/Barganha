# 00 — Visão de Produto

## Problema
O consumidor não tem memória nem referência de preços. Na gôndola, ele não sabe se R$ 7,90 numa caixa de leite é um bom preço, o preço normal, ou um abuso — e não tem como comparar entre mercados nem ao longo do tempo.

## Solução
**Barganha** transforma o cupom fiscal (que todo mundo já recebe) em uma base de dados de preços. Como a NFC-e traz os dados estruturados (incluindo o código de barras de cada item), o app constrói um histórico confiável e, por ser **colaborativo**, cada usuário se beneficia dos dados de todos.

Na hora da compra, o usuário consulta um produto e recebe um **veredito instantâneo**: barato / na média / caro — comparado por unidade (R$/kg, R$/L, R$/un) e pela sua região.

## Proposta de valor
- **Confiança:** dado vem do cupom fiscal, não de digitação manual.
- **Imediatismo de valor:** por ser colaborativo, o usuário novo já abre o app com preços da região dele (sem "banco vazio").
- **Privacidade:** nada de dados pessoais; base compartilhada é anônima.
- **Funciona offline** no corredor do mercado.

## Público
Consumidores brasileiros que fazem compras de mercado e querem economizar. Lançamento na Google Play (iOS depois), faseado por estado começando por RJ e SP.

## Jornadas principais
1. **Registrar compra:** usuário escaneia o QR do cupom → itens entram no histórico privado → preços anônimos alimentam a base.
2. **Consultar na gôndola:** usuário escaneia o código de barras (ou busca) → vê típico/mín/máx + veredito para o preço da prateleira.
3. **Acompanhar:** usuário vê seu histórico de gastos e a evolução de preços de itens que compra com frequência.

## Métricas de sucesso (norte)
- Nº de cupons escaneados / usuário ativo.
- Cobertura de produtos com estatística confiável por região.
- Taxa de consulta na gôndola → decisão (engajamento no momento da compra).
- Retenção (o efeito de rede só funciona se as pessoas voltarem e contribuírem).

## Fora de escopo (por enquanto)
- OCR de cupons antigos (ECF) — plano B futuro.
- Lançamento manual de preço de gôndola sem compra — fase posterior, com moderação.
- Integração com programas de fidelidade / e-commerce.

## Riscos e mitigação (resumo)
- **Cold-start de dados** → modelo colaborativo + lançamento concentrado por estado (densidade local).
- **Promoção distorcendo o "típico"** → estatística por mediana + exibição separada (ver `06`).
- **Diversidade de portais SEFAZ** → parsing no backend, faseado por estado (ver `03`).
- **Privacidade/LGPD** → separação rígida de dados privados e compartilhados (ver `04`).
