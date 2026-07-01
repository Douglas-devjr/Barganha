/**
 * `ClienteSefaz` real: busca o HTML da página de consulta da NFC-e na SEFAZ.
 *
 * Faz um GET na URL do QR (o portal renderiza a nota a partir do parâmetro
 * `p`). Falhas de rede/portal viram `FalhaBuscaSefazError` (transitória →
 * retry com backoff no processamento). Cada estado pode exigir ajuste fino de
 * cabeçalhos/URL; por isso o cliente é injetável e os parsers, versionados.
 */

import { FalhaBuscaSefazError, PayloadQrInvalidoError } from '../erros';
import { pareceDefesaAntiBot } from '../parsers/html';
import type { QrNfce } from '../parsers/qr-payload';
import type { ClienteSefaz } from '../parsers/tipos';

export interface OpcoesClienteSefaz {
  /** Timeout por requisição (ms). */
  timeoutMs?: number;
  /** Permite injetar um `fetch` (testes); default = `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** User-Agent enviado ao portal. */
  userAgent?: string;
  /** Charset assumido quando o portal não declara um (vários usam latin1). */
  charsetPadrao?: string;
}

const TIMEOUT_PADRAO_MS = 15_000;
// Portais SEFAZ (RJ, p.ex.) devolvem página de bloqueio a User-Agents "de robô".
// Usamos um UA de navegador real para alcançar a página da nota (ou o desafio).
const UA_PADRAO =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const CHARSET_PADRAO = 'utf-8';

/** Extrai o charset do header Content-Type (ex.: "text/html; charset=ISO-8859-1"). */
function charsetDeContentType(contentType: string | null): string | undefined {
  return contentType
    ?.match(/charset=([^;]+)/i)?.[1]
    ?.trim()
    .toLowerCase();
}

export class ClienteSefazHttp implements ClienteSefaz {
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly userAgent: string;
  private readonly charsetPadrao: string;

  constructor(opcoes: OpcoesClienteSefaz = {}) {
    this.timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
    this.fetchFn = opcoes.fetch ?? globalThis.fetch;
    this.userAgent = opcoes.userAgent ?? UA_PADRAO;
    this.charsetPadrao = opcoes.charsetPadrao ?? CHARSET_PADRAO;
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
        headers: {
          'user-agent': this.userAgent,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'pt-BR,pt;q=0.9',
        },
        signal: controle.signal,
      });
      if (!resposta.ok) {
        throw new FalhaBuscaSefazError(
          `SEFAZ ${qr.uf ?? '??'} respondeu ${resposta.status} ao consultar a nota.`,
        );
      }
      // Decodifica respeitando o charset declarado (muitos portais são latin1):
      // `text()` assume UTF-8 e corromperia acentos de razão social/descrição.
      const buffer = await resposta.arrayBuffer();
      const charset =
        charsetDeContentType(resposta.headers.get('content-type')) ?? this.charsetPadrao;
      let html: string;
      try {
        html = new TextDecoder(charset).decode(buffer);
      } catch {
        html = new TextDecoder(CHARSET_PADRAO).decode(buffer);
      }

      // 200 "de fachada": o portal devolveu bloqueio/desafio anti-bot, não a nota.
      // Trata como falha de busca (transitória) para NÃO marcar `falha` permanente.
      if (pareceDefesaAntiBot(html)) {
        throw new FalhaBuscaSefazError(
          `SEFAZ ${qr.uf ?? '??'} respondeu com página de bloqueio/desafio (anti-bot/reCAPTCHA), não a nota.`,
        );
      }
      return html;
    } catch (erro) {
      if (erro instanceof FalhaBuscaSefazError) throw erro;
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new FalhaBuscaSefazError(`Falha ao consultar a SEFAZ ${qr.uf ?? '??'}: ${motivo}.`);
    } finally {
      clearTimeout(timer);
    }
  }
}
