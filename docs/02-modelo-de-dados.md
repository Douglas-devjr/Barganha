# 02 — Modelo de Dados (rascunho v0)

> **Rascunho** sujeito a ajuste quando o design das telas for fornecido. A separação entre dados **privados** e **compartilhados** é, porém, não-negociável (ver `04`).

## Mapa das entidades

**Lado PRIVADO (no aparelho / escopo da conta — nunca compartilhado):**
- `usuario` · `cupom` · `item_cupom`

**Lado COMPARTILHADO (anônimo):**
- `loja` · `produto_canonico` · `produto_alias` · `observacao_preco` · `preco_estatistica`

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

### `item_cupom`
| campo | tipo | nota |
|---|---|---|
| id | uuid | PK |
| cupom_id | uuid | FK → cupom |
| produto_canonico_id | uuid | FK (pode ser nulo até casar) |
| descricao_original | text | como veio na nota |
| ean | text | código de barras, se houver |
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
| texto_original | text | descrição vista em cupons |
| confianca | numeric | score de casamento |
| confirmado | bool | confirmado por usuário/curadoria |

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
| observado_em | timestamptz | data de emissão da nota |

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
- A escrita em `observacao_preco` é feita **exclusivamente** pela camada de anonimização do backend, a partir de uma nota processada — **nunca** copiando `usuario_id`, `cupom_id` ou `chave_acesso`.
- `preco_estatistica` é o que o app baixa para o cache offline (delta sync por `atualizado_em` + escopo da região do usuário).
