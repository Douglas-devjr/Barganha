# 07 — Roadmap & MVP

## MVP (objetivo: dado confiável + valor central)
1. **Captura:** escanear QR da NFC-e → backend parseia (RJ + SP) → salvar histórico privado + observações anônimas.
2. **Histórico de preços:** construir e exibir o histórico do usuário.
3. **Consulta:** tela com leitura de código de barras (ou busca) → típico/mín/máx + veredito, offline-first.

Critérios de pronto do MVP:
- Escanear cupom de RJ/SP e ver os itens corretos no histórico.
- Consultar um produto na gôndola (offline) e receber veredito coerente com região.
- Nenhum dado pessoal persistido; checklist LGPD (doc `04`) verde.

## Fases

### Fase 0 — Fundação
- Setup do monorepo (app Expo + backend), CI, ambientes.
- Esquema do banco (doc `02`) + camada de anonimização.
- Contrato `NotaEstruturada` + 1º parser (RJ).

### Fase 1 — Captura ponta a ponta
- Leitura de QR + fila offline + upload.
- Parser RJ + SP atrás da interface comum.
- Histórico privado no app.

### Fase 2 — Base colaborativa & estatística
- Pool `observacao_preco` + motor `preco_estatistica` (mediana/percentis/geo/decaimento).
- Casamento por EAN; casamento por texto (com confirmação) para itens sem EAN.

### Fase 3 — Consulta & offline
- Tela de consulta + veredito + fallback hierárquico de escopo.
- Cache local + delta sync.

### Fase 4 — Lançamento RJ + SP (Google Play)
- Onboarding com consentimento LGPD.
- Telemetria de parsing por estado.
- Beta fechado → aberto.

### Fase 5+ — Expansão
- Novos estados (reprocessamento retroativo dos QRs pendentes).
- iOS (App Store).
- Lançamento manual de gôndola (com moderação).
- OCR de cupons ECF antigos.
- Enriquecimento de produtos (nome/foto/categoria).

## Métricas por fase
Ver `00-visao-produto.md` (norte). Acompanhar especialmente: cupons/usuário ativo, cobertura de produtos com estatística confiável por região, retenção.

## Dependência crítica
O **design das telas** (a ser fornecido pelo dono do produto) destrava o ajuste final do modelo de dados e o início da Fase 1.
