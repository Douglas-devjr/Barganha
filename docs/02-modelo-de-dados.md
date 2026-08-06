# 02 — Modelo de Dados (v1)

> **v1 implementado** na Camada 1 (C1): tabelas em `supabase/migrations/20260627091000_dominio_tabelas.sql` e tipos em `shared/src/dominio/`. Ajustes finos de campo podem vir com o design final das telas; o conjunto de entidades e a separação **privado**/**compartilhado** são, porém, não-negociáveis (ver `04`).
>
> Implementação: enums (`status_cupom`, `escopo_geo`) na baseline (C0.4); colunas de auditoria (`criado_em`/`atualizado_em`) acrescentadas às tabelas além dos campos de domínio abaixo.

## Mapa das entidades

**Lado PRIVADO (no aparelho / escopo da conta — nunca compartilhado):**
- `usuario` · `cupom` · `item_cupom`

**Lado COMPARTILHADO (anônimo):**
- `loja` · `produto_canonico` · `produto_alias` · `produto_codigo_loja` · `observacao_preco` · `preco_estatistica`

---

## Lado privado

### `usuario`
Mínimo possível. Sem nome, sem CPF.
| campo | tipo | nota |
|---|---|---|
| id | uuid | PK |
| criado_em | timestamptz | |
| (auth) | — | só o necessário para autenticação; avaliar conta anônima |

### `cupom` (nota do usuário)
| campo | tipo | nota |
|---|---|---|
| id | uuid | PK |
| usuario_id | uuid | FK → usuario (**privado**) |
| chave_acesso | text | **privado**; nunca vai ao pool |
| loja_cnpj | text | FK → loja |
| emitido_em | timestamptz | |
| uf | char(2) | |
| status | enum | `qr_capturado` · `processado` · `falha` |
| qr_payload | text | conteúdo cru do QR (para reprocessamento) |
| capturado_em | timestamptz | quando o app leu o QR (offline-first; difere de `criado_em`) |

### `item_cupom`
| campo | tipo | nota |
|---|---|---|
| id | uuid | PK |
| cupom_id | uuid | FK → cupom |
| produto_canonico_id | uuid | FK (pode ser nulo até casar) |
| descricao_original | text | como veio na nota |
| ean | text | código de barras, se houver |
| codigo_loja | text | código interno da loja (SKU), quando o portal só mostra ele |
| quantidade | numeric | |
| unidade | text | UN / KG / L … |
| valor_unitario | numeric | |
| valor_total | numeric | |
| desconto | numeric | sinal de promoção (ver `06`) |

---

## Lado compartilhado (anônimo)

### `loja`
Derivada do CNPJ. É a chave da geolocalização (ver `04`/`01`).
| campo | tipo | nota |
|---|---|---|
| cnpj | text | PK |
| razao_social | text | |
| nome_fantasia | text | |
| rede | text | rede/bandeira, se identificável |
| endereco | text | |
| municipio | text | unidade geo principal |
| uf | char(2) | |
| lat / long | numeric | opcional |

### `produto_canonico`
| campo | tipo | nota |
|---|---|---|
| id | uuid | PK |
| ean | text | único quando existir |
| descricao_normalizada | text | |
| marca | text | |
| categoria | text | |
| unidade_base | text | kg / L / un — base de comparação |
| imagem_url | text | opcional (enriquecimento) |

### `produto_alias`
Para casar descrições variadas (itens sem EAN, ou variações de texto) ao canônico.
| campo | tipo | nota |
|---|---|---|
| id | uuid | PK |
| produto_canonico_id | uuid | FK |
| texto_original | text | descrição vista em cupons, **normalizada** (é assim que a ingestão a busca) |
| unidade_base | text | do canônico alvo; impede um alias ligar kg a L |
| confianca | numeric | score de casamento |
| confirmado | bool | confirmado por usuário/curadoria |

> **Lido na ingestão** (passo 2 da ordem de casamento, ver `06`). Até a C3.6.1
> esta tabela era **write-only**: a curadoria confirmava e nada lia — o cupom
> seguinte recriava o fragmento. Índice único parcial em
> `(texto_original, unidade_base) where confirmado`.

### `produto_codigo_loja`
Chave determinística `(loja + código interno/SKU) → produto_canonico`, para os
portais que não expõem EAN (RJ/ENCAT, MG). **Catálogo**, não observação.

| campo | tipo | nota |
|---|---|---|
| loja_cnpj | text | FK → loja; parte da PK (o mesmo código significa coisas diferentes em redes diferentes) |
| codigo | text | como o portal mostra; parte da PK |
| raiz_cnpj | text | gerado (8 díg.) — herança entre filiais, atrás de flag |
| produto_canonico_id | uuid | FK |
| unidade_base | text | guarda de veto barata |
| descricao_referencia | text | base da guarda de similaridade |
| preco_referencia | numeric | âncora (EWMA lenta) só para **sinalizar** troca de item |
| ean_visto | text | ponte EAN ↔ código interno, quando a loja declara os dois |
| origem | enum | `ean` · `descricao_exata` · `humano` |
| status | enum | `ativo` · `suspeito` · `dormente` |
| hits / ultimo_visto | int / **date** | métrica de cobertura e regra de dormência |

> **LGPD:** CNPJ é estabelecimento, não pessoa; sem `usuario_id`/`cupom_id`/
> `chave_acesso`. `ultimo_visto` é **date**, nunca timestamp — com hora, duas
> linhas do mesmo instante reconstruiriam "estes itens estavam na mesma cesta"
> (regra 2 de `04`, o mesmo motivo de o gate zerar a hora de `observado_em`).
> Tabela **interna**: não sai na API do app nem no delta sync.

### `observacao_preco` — **o coração anônimo**
Inserida **solta** (um item por linha, sem vínculo com a cesta, sem `usuario_id`, sem `chave_acesso`).
| campo | tipo | nota |
|---|---|---|
| id | uuid | PK |
| produto_canonico_id | uuid | FK |
| loja_cnpj | text | FK → loja |
| municipio | text | desnormalizado para consulta geo |
| uf | char(2) | |
| preco_normalizado | numeric | já em R$/unidade_base |
| unidade_base | text | kg / L / un |
| em_promocao | bool | derivado do desconto / estatística |
| observado_em | timestamptz | **dia** de emissão (granularidade de dia no pool — o gate zera o horário para não reconstruir a cesta por `loja+horário`, ver `04`) |

### `preco_estatistica` — agregação para consulta rápida / cache
| campo | tipo | nota |
|---|---|---|
| produto_canonico_id | uuid | FK |
| escopo | enum | `loja` · `municipio` · `regiao` · `uf` |
| escopo_id | text | cnpj / município / etc. |
| unidade_base | text | |
| mediana | numeric | "típico" |
| p25 / p75 | numeric | faixa |
| minimo / maximo | numeric | |
| menor_promocional | numeric | "menor visto (promoção)" |
| n_observacoes | int | confiança da estatística |
| atualizado_em | timestamptz | mostrado como "última atualização" |

---

## Regras de integridade ligadas à privacidade
- A escrita em `observacao_preco` é feita **exclusivamente** pela camada de anonimização do backend, a partir de uma nota processada — **nunca** copiando `usuario_id`, `cupom_id` ou `chave_acesso`. O **gate único** (`extrairObservacoesAnonimas` em `shared/src/anonimizacao/gate.ts`, C1.4) garante isso em tempo de compilação: a saída colapsa para `never` se ganhar um campo de PII, e só ele produz o tipo `ObservacaoAnonima` que a persistência aceita.
- `preco_estatistica` é o que o app baixa para o cache offline (delta sync por `atualizado_em` + escopo da região do usuário).

---

## Mapeamento telas → entidades (v1)

Telas do protótipo (`design/code`) e as entidades que cada uma consome:

| Tela | Lê de | Observações |
|---|---|---|
| **Onboarding** (3 telas) | — | consentimento LGPD; cria `usuario` (mínimo). |
| **Início** (home) | `cupom`, `item_cupom` | card de economia + últimas compras (privado, local). |
| **Scanner** | `cupom` (`qr_payload`, `status`) | grava QR cru offline antes de tudo. |
| **Nota fiscal** | `cupom` + `item_cupom` | itens parseados da nota; "Salvar no histórico". |
| **Verificar** (gôndola) | `preco_estatistica` (cache) + `item_cupom` (histórico) | veredito híbrido: típico da região (mediana/p25/p75) **+** seu histórico; promoção à parte. |
| **Produtos** (lista) | `produto_canonico` + `preco_estatistica` | produtos do histórico/região. |
| **Detalhe do produto** | `produto_canonico` + `observacao_preco`/`preco_estatistica` | evolução 6 meses; menor visto. |
| **Estatísticas** | `cupom`/`item_cupom` agregados | gastos por mês/categoria/onde economiza `[Pós]`. |
| **Perfil** | `usuario` + `loja` (favoritas) | dados mínimos, mercados favoritos. |

> O protótipo rotula o típico como "média ±5%"; o modelo v1 usa **mediana/percentis** (`preco_estatistica`), nunca média — ajuste já refletido em `06`.
