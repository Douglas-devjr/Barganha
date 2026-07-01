/**
 * Parser de NFC-e de São Paulo (C2.3). SP usa o layout ENCAT "consulta via
 * consumidor" — o parsing puro vive em `parseHtmlEncat` (compartilhado com o
 * portal atual do RJ). Aqui ficam só a UF/versão e a ligação com o `ClienteSefaz`.
 *
 * IMPORTANTE: o CPF do consumidor, se presente, NÃO é extraído (docs/04).
 */

import type { NotaEstruturada } from '@barganha/shared';

import { parseHtmlEncat } from './encat';
import type { QrNfce } from './qr-payload';
import type { ClienteSefaz, ParserSefaz } from './tipos';

export const UF_SP = 'SP';
export const VERSAO_PARSER_SP = '2026.1';

/** HTML do portal de SP (layout ENCAT) → `NotaEstruturada`. Puro e testável. */
export function parseHtmlSp(html: string): NotaEstruturada {
  return parseHtmlEncat(html, UF_SP);
}

/** Parser SP implementando o contrato comum (`ParserSefaz`). */
export class ParserSp implements ParserSefaz {
  readonly uf = UF_SP;
  readonly versao = VERSAO_PARSER_SP;

  constructor(private readonly cliente: ClienteSefaz) {}

  suportaUF(uf: string): boolean {
    return uf === this.uf;
  }

  async parse(qr: QrNfce): Promise<NotaEstruturada> {
    const html = await this.cliente.buscarConsulta(qr);
    return parseHtmlSp(html);
  }

  parseHtml(html: string): NotaEstruturada {
    return parseHtmlSp(html);
  }
}
