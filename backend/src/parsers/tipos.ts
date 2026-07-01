/**
 * Contratos da camada de captura SEFAZ (docs/03).
 *
 * Cada estado tem um portal diferente; os parsers vivem atrás destas
 * interfaces para que adicionar/corrigir um estado não exija atualizar o app.
 * A busca na SEFAZ (`ClienteSefaz`) é separada do parsing do HTML para que os
 * parsers sejam testáveis com fixtures, sem rede.
 */

import type { NotaEstruturada } from '@barganha/shared';

import type { QrNfce } from './qr-payload';

/**
 * Busca o HTML da página de consulta da NFC-e na SEFAZ do estado.
 * Implementações: HTTP real (produção) e em memória/fixture (teste).
 */
export interface ClienteSefaz {
  buscarConsulta(qr: QrNfce): Promise<string>;
}

/**
 * Parser de NFC-e de uma UF. `parse` busca na SEFAZ (via `ClienteSefaz`) e
 * estrutura o resultado no contrato único `NotaEstruturada`. `versao` permite
 * versionar o parser quando o portal muda de layout (docs/03 — robustez).
 */
export interface ParserSefaz {
  readonly uf: string;
  readonly versao: string;
  suportaUF(uf: string): boolean;
  parse(qr: QrNfce): Promise<NotaEstruturada>;
  /**
   * Estrutura um HTML de nota JÁ OBTIDO, sem tocar a rede. Usado quando o portal
   * exige navegador/reCAPTCHA e o próprio app colhe o HTML renderizado (C2.6). O
   * parsing continua no backend (decisão travada nº2) — o app só entrega o HTML.
   */
  parseHtml(html: string): NotaEstruturada;
}
