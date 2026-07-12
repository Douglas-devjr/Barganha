/**
 * C5.4 — Cliente de API tipado. Espelha os endpoints do backend (docs/01) e
 * consome EXCLUSIVAMENTE os DTOs de @barganha/shared — sem redefinir contratos.
 *
 * Separação de mundos (docs/04):
 *   • Privado  : `ingerirQr`/`apagarConta` exigem Bearer (JWT do login, C4.3.1).
 *   • Anônimo  : `consultarPreco` e `sincronizar` leem só o pool — sem conta.
 *
 * Offline-first: a UI resolve do cache local primeiro; este cliente só é
 * chamado quando há sinal (refino/sync). Erros viram `ErroApi` tipado.
 */

import type {
  ComparacaoListaRequest,
  ComparacaoListaResponse,
  ConsultaPrecoRequest,
  ConsultaPrecoResponse,
  CupomResponse,
  DeltaSyncRequest,
  DeltaSyncResponse,
  IngestaoHtmlRequest,
  IngestaoQrRequest,
  IngestaoQrResponse,
} from '@barganha/shared';

import { obterBaseUrl } from './config';

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    /** Código de máquina do backend (ex.: `desafio`/`erro_portal` no 422 da C2.6). */
    readonly codigo?: string,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

// Sem timeout, um servidor INALCANÇÁVEL (IP da LAN fora da rede do celular, ou
// firewall dropando pacotes em silêncio) deixa o fetch pendurado por minutos e a
// UI presa em "Enviando/Processando…" sem nunca cair no estado offline. Abortar
// vira `ErroApi(0)` — transitório: o sincronizador re-tenta com backoff.
const TIMEOUT_REQUISICAO_MS = 15000;

export interface OpcoesClienteApi {
  baseUrl?: string;
  /** Fornece o Bearer (usuarioId) para endpoints privados. */
  obterToken?: () => Promise<string | null> | string | null;
}

interface CorpoErro {
  erro?: string;
  codigo?: string;
}

export class ClienteApi {
  private readonly baseUrl: string;
  private readonly obterToken?: OpcoesClienteApi['obterToken'];

  constructor(opcoes: OpcoesClienteApi = {}) {
    this.baseUrl = (opcoes.baseUrl ?? obterBaseUrl()).replace(/\/+$/, '');
    this.obterToken = opcoes.obterToken;
  }

  /** `POST /ingestao/qr` (C2.1) — PRIVADO: envia o QR cru; exige Bearer. 202. */
  async ingerirQr(req: IngestaoQrRequest): Promise<IngestaoQrResponse> {
    const token = await this.resolverToken();
    if (!token) throw new ErroApi(401, 'Sessão expirada. Entre de novo para registrar cupons.');
    return this.requisitar<IngestaoQrResponse>('POST', '/ingestao/qr', req, token);
  }

  /**
   * `POST /ingestao/cupom/:id/html` (C2.6) — PRIVADO. Envia o HTML da nota já
   * renderizada (colhido pelo WebView no aparelho, quando o portal exige
   * navegador/reCAPTCHA). O backend PARSEIA e devolve o cupom atualizado. Um 422
   * significa que o HTML ainda é a página de desafio — reabrir/aguardar e reenviar.
   */
  async ingerirHtmlCupom(cupomIdServidor: string, html: string): Promise<CupomResponse> {
    const token = await this.resolverToken();
    if (!token) throw new ErroApi(401, 'Sessão expirada. Entre de novo para registrar cupons.');
    const req: IngestaoHtmlRequest = { html };
    return this.requisitar<CupomResponse>(
      'POST',
      `/ingestao/cupom/${encodeURIComponent(cupomIdServidor)}/html`,
      req,
      token,
    );
  }

  /**
   * `DELETE /conta` (C4.3.1) — PRIVADO: apaga a conta e, em cascata, todo o
   * histórico no servidor (direito ao apagamento, docs/04). Exige Bearer.
   */
  async apagarConta(): Promise<void> {
    const token = await this.resolverToken();
    if (!token) throw new ErroApi(401, 'Sem sessão para apagar a conta.');
    await this.requisitar<void>('DELETE', '/conta', undefined, token);
  }

  /**
   * `GET /ingestao/cupom/:id` (C6.3) — PRIVADO: estado/itens do cupom do próprio
   * usuário; exige Bearer. Usado para acompanhar o parsing assíncrono. Retorna
   * `null` em 404 (cupom ainda não chegou ao servidor ou não é seu).
   */
  async obterCupom(cupomIdServidor: string): Promise<CupomResponse | null> {
    const token = await this.resolverToken();
    if (!token) throw new ErroApi(401, 'Sem conta para consultar o cupom.');
    try {
      return await this.requisitar<CupomResponse>(
        'GET',
        `/ingestao/cupom/${encodeURIComponent(cupomIdServidor)}`,
        undefined,
        token,
      );
    } catch (e) {
      if (e instanceof ErroApi && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * `POST /consulta/preco` (C4.1) — ANÔNIMO. Resolve por EAN ou nome + recorte
   * geo. Retorna `null` em 404 (sem dados para o produto).
   */
  async consultarPreco(req: ConsultaPrecoRequest): Promise<ConsultaPrecoResponse | null> {
    try {
      return await this.requisitar<ConsultaPrecoResponse>('POST', '/consulta/preco', req);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * `POST /consulta/lista` (C12.1) — ANÔNIMO. Compara a cesta entre as lojas do
   * recorte geográfico ("onde minha lista sai mais barata").
   */
  compararLista(req: ComparacaoListaRequest): Promise<ComparacaoListaResponse> {
    return this.requisitar<ComparacaoListaResponse>('POST', '/consulta/lista', req);
  }

  /** `POST /sync/estatisticas` (C4.2) — ANÔNIMO. Delta desde o cursor. */
  sincronizar(req: DeltaSyncRequest): Promise<DeltaSyncResponse> {
    return this.requisitar<DeltaSyncResponse>('POST', '/sync/estatisticas', req);
  }

  // ──────────────────────────────────────────────────────────────────────

  private async resolverToken(): Promise<string | null> {
    if (!this.obterToken) return null;
    return (await this.obterToken()) ?? null;
  }

  private async requisitar<T>(
    metodo: string,
    caminho: string,
    corpo?: unknown,
    token?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const aborto = new AbortController();
    const timer = setTimeout(() => aborto.abort(), TIMEOUT_REQUISICAO_MS);
    let resposta: Response;
    try {
      resposta = await fetch(`${this.baseUrl}${caminho}`, {
        method: metodo,
        headers,
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: aborto.signal,
      });
    } catch {
      throw new ErroApi(0, 'Sem conexão com o servidor.');
    } finally {
      clearTimeout(timer);
    }

    if (!resposta.ok) {
      let mensagem = `Erro ${resposta.status}.`;
      let codigo: string | undefined;
      try {
        const json = (await resposta.json()) as CorpoErro;
        if (json.erro) mensagem = json.erro;
        codigo = json.codigo;
      } catch {
        // resposta sem corpo JSON — mantém a mensagem padrão.
      }
      throw new ErroApi(resposta.status, mensagem, codigo);
    }

    if (resposta.status === 204) return undefined as T;
    return (await resposta.json()) as T;
  }
}
