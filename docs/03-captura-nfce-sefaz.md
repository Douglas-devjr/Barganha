# 03 — Captura NFC-e / SEFAZ

## Contexto
A **NFC-e** (Nota Fiscal de Consumidor Eletrônica, modelo 65) é o cupom usado pela maioria do varejo brasileiro. Ela traz:
- Um **QR code** que aponta para o portal de consulta da **SEFAZ do estado**.
- Uma **chave de acesso** de 44 dígitos.

A página de consulta da SEFAZ contém os dados **estruturados**: estabelecimento (CNPJ, razão social, endereço), data/hora e cada item com descrição, **código de barras (EAN/GTIN)**, quantidade, unidade, valor unitário e total.

## Estratégia: QR-first
1. O app lê o **QR code** e guarda o **payload cru** imediatamente (offline-safe).
2. O backend recebe o payload, identifica o **estado** e aciona o **parser** correspondente, que busca e estrutura os dados da SEFAZ.

> OCR de foto é **plano B futuro**, apenas para cupons antigos de máquina ECF (sem QR). Não faz parte do MVP.

## Parsing no backend (nunca no app)
Cada estado tem um portal SEFAZ diferente (HTML/estrutura diferentes). Por isso:
- Os parsers vivem no **backend**, isolados atrás de uma **interface comum**:
  ```
  interface ParserSefaz {
    suportaUF(uf): boolean
    parse(qrPayload): Promise<NotaEstruturada>
  }
  ```
- Adicionar/corrigir um estado **não exige atualizar o app na loja**.
- `NotaEstruturada` é o contrato único consumido pelo resto do sistema:
  ```
  NotaEstruturada {
    loja: { cnpj, razaoSocial, nomeFantasia?, endereco, municipio, uf }
    emitidoEm: datetime
    itens: Array<{
      descricao, ean?, quantidade, unidade,
      valorUnitario, valorTotal, desconto?
    }>
    // CPF, se presente, é IGNORADO aqui — nunca propagado.
  }
  ```

## Faseamento por estado
- Lançar com **RJ + SP** (maior volume).
- O app **guarda o QR cru de qualquer estado desde o dia 1**. Quando o parser de um novo estado entra no ar, os cupons pendentes daquele estado são **reprocessados retroativamente**.
- Status do cupom: `qr_capturado` → (parser disponível?) → `processado` | `falha`.

## Robustez
- **Fila assíncrona** para o parsing: isola picos e instabilidade dos portais SEFAZ.
- **Retry com backoff** quando o portal está fora do ar.
- **Versionar** cada parser; quando um portal muda de layout, só aquele parser é corrigido e os afetados reprocessados.
- **Telemetria por estado** (taxa de sucesso de parsing) para priorizar manutenção.

## Pontos de atenção
- Disponibilidade do portal SEFAZ varia por estado e horário → nunca bloquear o usuário; processar em background.
- Itens **sem EAN** (hortifruti, padaria, açougue) → encaminhados ao casamento por texto (ver `06`).
- A **chave de acesso** fica **somente** no lado privado (liga a CPF via SEFAZ) — ver `04`.
