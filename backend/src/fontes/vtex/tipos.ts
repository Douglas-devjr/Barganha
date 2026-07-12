/**
 * Fontes externas de catálogo (C11.5 automático / C12.4) — contratos.
 *
 * Uma "rede" é um mercado com e-commerce na plataforma VTEX, cujo catálogo
 * público expõe produto/EAN/marca/foto/preço. REGRA TRAVADA: o que vem daqui é
 * EXIBIÇÃO (enriquecimento) e, futuramente, a camada separada de ofertas
 * anunciadas (C12.4) — NUNCA entra em `observacao_preco` nem na mediana
 * (o pool é só preço TRANSACIONADO de cupom fiscal).
 *
 * As redes vêm de configuração (`REDES_VTEX`): remover uma rede que reclame ou
 * bloqueie é apagar uma entrada de env, sem deploy de código.
 */

export interface RedeVtex {
  /** Identificador curto (telemetria/log). Ex.: "zonasul". */
  id: string;
  /** Nome de exibição da rede. */
  nome: string;
  /** Domínio da loja VTEX (sem protocolo). Ex.: "www.zonasul.com.br". */
  dominio: string;
}

/** Produto do catálogo público de uma rede — o recorte que o Barganha usa. */
export interface ProdutoCatalogo {
  ean: string;
  nome: string;
  marca?: string;
  /** Categoria mais específica (último segmento de "/Mercearia/Café/"). */
  categoria?: string;
  imagemUrl?: string;
  /**
   * Preço anunciado no e-commerce (R$). Reservado ao C12.4 (ofertas em camada
   * separada) — proibido no pool/mediana por construção.
   */
  precoAnunciado?: number;
  disponivel?: boolean;
}

/** Porta da fonte de catálogo — trocável por API paga/parceria sem reescrever. */
export interface FonteCatalogo {
  /** Produto da rede pelo EAN; `undefined` quando a rede não o vende. */
  buscarPorEan(rede: RedeVtex, ean: string): Promise<ProdutoCatalogo | undefined>;
}
