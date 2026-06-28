/**
 * Erros de domínio do backend (C2). A camada HTTP (Fastify) mapeia cada um
 * para um status code; o processamento assíncrono decide o que dá retry.
 */

/** Base de todos os erros de domínio — permite `instanceof ErroDominio`. */
export abstract class ErroDominio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = new.target.name;
  }
}

/** Payload do QR malformado (não é URL/chave reconhecível). Erro do cliente. */
export class PayloadQrInvalidoError extends ErroDominio {}

/** Chave de acesso (44 díg.) inválida — tamanho, não-numérica ou DV incorreto. */
export class ChaveAcessoInvalidaError extends ErroDominio {}

/**
 * Não há parser para a UF ainda. NÃO é erro de ingestão: o QR cru é guardado
 * para reprocessamento retroativo quando o parser do estado entrar (docs/03).
 */
export class UfNaoSuportadaError extends ErroDominio {
  constructor(readonly uf: string) {
    super(`Sem parser para a UF "${uf}" — cupom guardado para reprocessamento.`);
  }
}

/**
 * Falha de REDE/portal ao buscar a consulta na SEFAZ. É transitória: o
 * processamento deve dar retry com backoff (portal fora do ar, timeout).
 */
export class FalhaBuscaSefazError extends ErroDominio {}

/**
 * Falha ao PARSEAR o HTML da SEFAZ (layout mudou, campo ausente). Não é
 * transitória: marca o cupom como `falha` e exige correção do parser (versão).
 */
export class FalhaParserSefazError extends ErroDominio {}
