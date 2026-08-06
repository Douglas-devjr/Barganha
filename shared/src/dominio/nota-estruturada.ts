/**
 * `NotaEstruturada` — contrato ÚNICO de saída dos parsers SEFAZ (docs/03).
 *
 * Todo parser estadual (`parse(qrPayload) → NotaEstruturada`) entrega este
 * formato; o resto do sistema só conhece ele, nunca o HTML/layout de cada UF.
 *
 * IMPORTANTE: o CPF do consumidor, se presente na NFC-e, é IGNORADO aqui —
 * nunca entra neste contrato nem é propagado adiante (docs/04).
 */

/** Estabelecimento como vem da SEFAZ (base para `loja`, via CNPJ). */
export interface LojaEstruturada {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  endereco: string;
  municipio: string;
  uf: string;
}

/** Item da nota como vem da SEFAZ (ainda não normalizado nem casado). */
export interface ItemEstruturado {
  descricao: string;
  /** Código de barras, quando houver (hortifruti/padaria/açougue não têm). */
  ean?: string;
  /**
   * Código INTERNO do item na loja (SKU), quando o campo de código da nota NÃO
   * é um EAN válido. Vários portais (RJ legado/ENCAT, MG) mostram, para itens
   * de hortifruti/padaria/açougue, um código curto PRÓPRIO da loja — não um
   * código de barras (`eanDeCodigo`, em `backend/src/parsers/html.ts`,
   * corretamente recusa esse valor como `ean`). Até este campo existir, esse
   * texto era descartado sem deixar rastro.
   *
   * Evidência real: a MESMA loja usa sempre o MESMO código para o MESMO item
   * (é o SKU/registro dela) — candidato a uma chave de casamento determinística
   * "loja + código interno → produto_canonico" (decisão de modelagem do
   * data-scientist, C3.x; aqui só preservamos o dado até lá).
   *
   * Texto CRU (só colapsando espaços, sem forçar dígitos — o `cProd` do NFe
   * pode ser alfanumérico; ver docs/03), para não corromper um SKU que não seja
   * puramente numérico. Ausente quando já há `ean` (o mesmo valor seria
   * redundante) ou quando a nota não expõe nenhum código de item.
   */
  codigoLoja?: string;
  quantidade: number;
  /** Unidade da nota (UN, KG, L, …) — base para normalizar ao `unidade_base`. */
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
  /** Sinal de promoção da própria NFC-e (docs/06). */
  desconto?: number;
}

/**
 * Totais do cupom (docs/06). O layout ENCAT "consulta via consumidor" só traz o
 * desconto AGREGADO (não por item), então guardamos aqui o valor bruto, o
 * desconto total e o valor efetivamente pago — a atribuição do desconto a cada
 * item, quando o portal não a fornece, é feita pelo usuário no app.
 */
export interface TotaisNota {
  /** Soma dos itens antes do desconto (R$). */
  bruto: number;
  /** Desconto total do cupom (R$). */
  desconto: number;
  /** Valor efetivamente pago = bruto − desconto (R$). */
  pago: number;
}

export interface NotaEstruturada {
  loja: LojaEstruturada;
  /** Data/hora de emissão (ISO 8601). */
  emitidoEm: string;
  itens: ItemEstruturado[];
  /** Totais do cupom (bruto/desconto/pago), quando o portal os fornece. */
  total?: TotaisNota;
}
