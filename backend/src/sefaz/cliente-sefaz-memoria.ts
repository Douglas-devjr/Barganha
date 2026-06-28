/**
 * `ClienteSefaz` em memória para testes/dev: devolve um HTML fixo por UF, sem
 * tocar a rede. Permite testar o fluxo de processamento ponta a ponta com as
 * fixtures dos parsers.
 */

import { FalhaBuscaSefazError } from '../erros';
import type { QrNfce } from '../parsers/qr-payload';
import type { ClienteSefaz } from '../parsers/tipos';

export class ClienteSefazMemoria implements ClienteSefaz {
  /** Mapa UF → HTML de consulta a devolver. */
  constructor(private readonly htmlPorUf: Record<string, string>) {}

  buscarConsulta(qr: QrNfce): Promise<string> {
    const html = qr.uf ? this.htmlPorUf[qr.uf] : undefined;
    if (html === undefined) {
      return Promise.reject(
        new FalhaBuscaSefazError(`Sem HTML de teste para a UF "${qr.uf ?? '??'}".`),
      );
    }
    return Promise.resolve(html);
  }
}
