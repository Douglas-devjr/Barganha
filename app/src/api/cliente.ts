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
  ConsultaPrecoRequest,
  ConsultaPrecoResponse,
  CupomResponse,
  DeltaSyncRequest,
  DeltaSyncResponse,
  IngestaoQrRequest,
  IngestaoQrResponse,
} from '@barganha/shared';

import { obterBaseUrl } from './config';

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

export interface OpcoesClienteApi {
  baseUrl?: string;
  /** Fornece o Bearer (usuarioId) para endpoints privados. */
  obterToken?: () => Promise<string | null> | string | null;
}

interface CorpoErro {
  erro?: string;
}

export class ClienteApi {
  private readonly baseUrl: string;
  private readonly obterToken?: OpcoesClienteApi['obterToken'];

  constructor(opcoes: OpcoesClienteApi = {}) {
    this.baseUrl = (opcoes.baseUrl ?? obterBaseUrl()).replace(/\/+$/, '');
    this.obterToken = opcoes.obterToken;
  }

  /** `GET /saude` — diagnóstico de conectividade. */
  async saude(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/saude`);
      return r.ok;
    } catch {
      return false;
    }
  }

  /** `POST /ingestao/qr` (C2.1) — PRIVADO: envia o QR cru; exige Bearer. 202. */
  async ingerirQr(req: IngestaoQrRequest): Promise<IngestaoQrResponse> {
    const token = await this.resolverToken();
    if (!token) throw new ErroApi(401, 'Sessão expirada. Entre de novo para registrar cupons.');
    return this.requisitar<IngestaoQrResponse>('POST', '/ingestao/qr', req, token);
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

    let resposta: Response;
    try {
      resposta = await fetch(`${this.baseUrl}${caminho}`, {
        method: metodo,
        headers,
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      });
    } catch {
      throw new ErroApi(0, 'Sem conexão com o servidor.');
    }

    if (!resposta.ok) {
      let mensagem = `Erro ${resposta.status}.`;
      try {
        const json = (await resposta.json()) as CorpoErro;
        if (json.erro) mensagem = json.erro;
      } catch {
        // resposta sem corpo JSON — mantém a mensagem padrão.
      }
      throw new ErroApi(resposta.status, mensagem);
    }

    if (resposta.status === 204) return undefined as T;
    return (await resposta.json()) as T;
  }
}
