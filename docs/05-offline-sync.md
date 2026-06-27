# 05 — Offline & Sincronização

## Por que offline importa
O caso de uso crítico — consultar um preço **no corredor do mercado** — acontece frequentemente com sinal ruim. Além disso, registrar um cupom não pode depender de conexão. Portanto: **offline-first**.

## O que funciona offline
- **Registrar cupom:** 100% offline. O QR cru é salvo localmente e enfileirado para upload.
- **Consultar preço:** o veredito é resolvido a partir do **cache local** de estatísticas.

## O que NÃO precisa estar offline
- Parsing da SEFAZ (depende de internet, mas roda em background no backend).
- Atualização das estatísticas (sync incremental quando há sinal).

## Estratégia de cache (escopado, não total)
O app **não** baixa o Brasil inteiro. O cache cobre apenas:
1. **Produtos do histórico do usuário.**
2. **A região do usuário** (município(s) onde ele compra).

> Dado de preço é minúsculo (poucos bytes por estatística) — milhares de produtos cabem em poucos MB. Storage **não** é gargalo.

## Delta sync
- Baixa **apenas o que mudou** desde a última sincronização (`preco_estatistica.atualizado_em` > último cursor), dentro do escopo da região/produtos do usuário.
- Roda em background (preferência por Wi-Fi / carregando).
- Botão de **"atualizar"** manual disponível.

## Por que dado "de semana passada" basta
O veredito usa a **faixa típica** (mediana/percentis), que é **estável**: muda em semanas, não em horas. R$ 8,00 hoje virar R$ 8,50 amanhã **não** altera o veredito "típico ~R$ 8,00". Logo, sync diário/sob demanda é suficiente.

## Transparência de frescor
Cada estatística carrega `atualizado_em`, exibido como **"última atualização"**, para o usuário saber o quão recente é o dado.

## Fila de upload (cupons)
- QRs capturados ficam numa fila local persistente.
- Upload com retry/backoff quando volta o sinal.
- Idempotência por `chave_acesso` (não duplicar nota já enviada).

## Modelo de dados local (SQLite)
- Espelho do **lado privado** (`cupom`, `item_cupom`).
- **Cache** de `preco_estatistica` (escopo da região/produtos do usuário).
- Tabela de **fila de sync** (uploads pendentes + cursor de delta).

## Decisões a fechar com backend/data engineer
- Cursor de delta: timestamp vs. número de sequência.
- Política de expiração do cache (quando descartar estatística de produto que o usuário não consulta há muito tempo).
- Resolução de conflito: o cache é read-only derivado do servidor → conflito mínimo; uploads são append-only.
