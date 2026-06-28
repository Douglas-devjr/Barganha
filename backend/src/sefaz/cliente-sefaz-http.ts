/**
 * `ClienteSefaz` real: busca o HTML da página de consulta da NFC-e na SEFAZ.
 *
 * Faz um GET na URL do QR (o portal renderiza a nota a partir do parâmetro
 * `p`). Falhas de rede/portal viram `FalhaBuscaSefazError` (transitória →
 * retry com backoff no processamento). Cada estado pode exigir ajuste fino de
 * cabeçalhos/URL; por isso o cliente é injetável e os parsers, versionados.
 */

import { FalhaBuscaSefazError, PayloadQrInvalidoError } from '../erros';
import type { QrNfce } from '../parsers/qr-payload';
import type { ClienteSefaz } from '../parsers/tipos';

export interface OpcoesClienteSefaz {
  /** Timeout por requisição (ms). */
  timeoutMs?: number;
  /** Permite injetar um `fetch` (testes); default = `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** User-Agent enviado ao portal. */
  userAgent?: string;
}

const TIMEOUT_PADRAO_MS = 15_000;
const UA_PADRAO = 'BarganhaBot/1.0 (+https://barganha.app)';

export class ClienteSefazHttp implements ClienteSefaz {
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly userAgent: string;

  constructor(opcoes: OpcoesClienteSefaz = {}) {
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
    this.fetchFn = opcoes.fetch ?? globalThis.fetch;
    this.userAgent = opcoes.userAgent ?? UA_PADRAO;
  }

  async buscarConsulta(qr: QrNfce): Promise<string> {
    if (!qr.urlConsulta) {
      // Sem URL não há o que consultar via HTTP (payload era só a chave).
      throw new PayloadQrInvalidoError('QR sem URL de consulta — não é possível buscar na SEFAZ.');
    }

    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), this.timeoutMs);
    try {
      const resposta = await this.fetchFn(qr.urlConsulta, {
        headers: { 'user-agent': this.userAgent, accept: 'text/html' },
        signal: controle.signal,
      });
      if (!resposta.ok) {
        throw new FalhaBuscaSefazError(
          `SEFAZ ${qr.uf ?? '??'} respondeu ${resposta.status} ao consultar a nota.`,
        );
      }
      return await resposta.text();
    } catch (erro) {
      if (erro instanceof FalhaBuscaSefazError) throw erro;
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new FalhaBuscaSefazError(`Falha ao consultar a SEFAZ ${qr.uf ?? '??'}: ${motivo}.`);
    } finally {
      clearTimeout(timer);
    }
  }
}
