# Barganha

**Saiba se o preço vale a barganha.** App mobile que escaneia cupons fiscais de mercado (NFC-e), monta uma base colaborativa e anônima de preços e, na hora da compra, diz se o produto está **barato, na média ou caro** — comparando sempre por R$/kg, R$/L ou R$/un, e por região.

## Como funciona
1. **Escaneie o QR** do cupom fiscal (NFC-e). O app busca os dados estruturados na SEFAZ — estabelecimento, data e cada item com código de barras, quantidade, unidade e valor.
2. Os preços alimentam, de forma **anônima**, uma **base colaborativa** organizada por produto e por região.
3. **Na gôndola**, escaneie o código de barras (ou busque o produto) e veja o **preço típico**, o **menor já visto** e um veredito: tá barato, na média ou caro.

## Princípios
- **Privacidade em primeiro lugar (LGPD).** Seus dados pessoais nunca são salvos; o que vira base compartilhada é anônimo.
- **Funciona offline.** Registre cupons e consulte preços mesmo sem sinal.
- **Dado confiável.** Vem direto do cupom fiscal, não de digitação.

## Desenvolvimento
Monorepo (npm workspaces) com três pacotes: [`shared/`](shared/) (tipos/contratos), [`backend/`](backend/) (parsers SEFAZ + API) e [`app/`](app/) (Expo — a partir da Camada 5). Banco em [`supabase/`](supabase/).

```bash
npm install        # instala todas as workspaces
npm run check      # formatação + lint + tipos + testes (o mesmo que a CI roda)
```

Scripts úteis: `npm run lint`, `npm run typecheck`, `npm test`, `npm run format`. O passo a passo das etapas está em [`docs/11-catalogo-de-etapas.md`](docs/11-catalogo-de-etapas.md). Para rodar em dev, atualizar (OTA) e gerar build, veja [`COMANDOS.md`](COMANDOS.md); para o passo a passo completo do zero, [`COMO-RODAR.md`](COMO-RODAR.md).

## Documentação
A documentação completa do produto e da arquitetura está em [`docs/`](docs/). Comece por [`docs/00-visao-produto.md`](docs/00-visao-produto.md).

## Status
Em início de desenvolvimento. Lançamento faseado por estado, começando por **RJ + SP**, na Google Play (iOS posteriormente).
