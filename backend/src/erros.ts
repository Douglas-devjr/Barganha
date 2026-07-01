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

/**
 * O HTML enviado pelo app (colhido via WebView, C2.6) ainda é a página de
 * bloqueio/desafio (reCAPTCHA/IP), não a nota. NÃO é falha do cupom: o app deve
 * reabrir/aguardar o portal renderizar a nota e reenviar. Mapeada para 4xx.
 */
export class HtmlDesafioError extends ErroDominio {}

/**
 * Lançamento manual de gôndola (C11.3) recusado na entrada: unidade não
 * normalizável ou CNPJ inválido. Erro do cliente — não entra na fila de
 * moderação (só guardamos o que pode virar observação comparável).
 */
export class LancamentoInvalidoError extends ErroDominio {}

/**
 * OCR de cupom ECF antigo (C11.4) ainda não disponível. A captura é QR-first
 * (decisão travada nº1); o OCR é plano B futuro. O contrato existe, mas nenhum
 * motor está plugado — sinalizar 501 em vez de fingir que funciona.
 */
export class OcrNaoDisponivelError extends ErroDominio {}
