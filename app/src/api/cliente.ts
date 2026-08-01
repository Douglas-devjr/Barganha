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
  BuscaProdutosRequest,
  BuscaProdutosResponse,
  ComparacaoListaRequest,
  ComparacaoListaResponse,
  ConsultaPrecoRequest,
  ConsultaPrecoResponse,
  CupomResponse,
  DeltaSyncRequest,
  DeltaSyncResponse,
  DenunciaPrecoRequest,
  DenunciaPrecoResponse,
  HistoricoCuponsResponse,
  IngestaoHtmlRequest,
  IngestaoQrRequest,
  IngestaoQrResponse,
  LancamentoManualRequest,
  LancamentoManualResponse,
  SyncProdutosRequest,
  SyncProdutosResponse,
} from '@barganha/shared';

import { gerarRequestId, HEADER_REQUEST_ID } from '@barganha/shared';

import { obterBaseUrl } from './config';
import { ehRemoto, escolherTimeout } from './politica-timeout';

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    /** Código de máquina do backend (ex.: `desafio`/`erro_portal` no 422 da C2.6). */
    readonly codigo?: string,
    /**
     * C10.4 — Request ID daquela chamada. É o que permite pegar o print do
     * usuário e achar a linha exata no log do servidor. Presente mesmo quando o
     * backend não respondeu (`status` 0): o id é gerado ANTES do envio, então
     * timeout e queda de rede também ficam rastreáveis pelo lado do app.
     */
    readonly requestId?: string,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

// Sem timeout, um servidor INALCANÇÁVEL (IP da LAN fora da rede do celular, ou
// firewall dropando pacotes em silêncio) deixa o fetch pendurado por minutos e a
// UI presa em "Enviando/Processando…" sem nunca cair no estado offline. Abortar
// vira `ErroApi(0)` — transitório: o sincronizador re-tenta com backoff.
//
// O teto NÃO é fixo: o plano free do Render hiberna e o primeiro request depois
// do silêncio precisa de mais fôlego. Quem decide é `politica-timeout`.
//
// Estado de módulo, não de instância: "a instância do Render está acordada" é
// fato do processo inteiro, e cada tela constrói o seu próprio ClienteApi.
let ultimoContatoEm: number | null = null;

export interface OpcoesClienteApi {
  baseUrl?: string;
  /** Fornece o Bearer (usuarioId) para endpoints privados. */
  obterToken?: () => Promise<string | null> | string | null;
}

interface CorpoErro {
  erro?: string;
  codigo?: string;
  /** Eco do Request ID (C10.4) — o servidor devolve o mesmo que recebeu. */
  requestId?: string;
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
   * `GET /ingestao/cupons` — PRIVADO: página do histórico do próprio usuário para
   * a rehidratação no login (restore, docs/04). Exige Bearer. O app itera as
   * páginas pelo `proximoCursor` até esgotar; nunca toca o pool anônimo.
   */
  async listarHistorico(cursor?: string, limite?: number): Promise<HistoricoCuponsResponse> {
    const token = await this.resolverToken();
    if (!token) throw new ErroApi(401, 'Sem sessão para restaurar o histórico.');
    const qs = new URLSearchParams();
    if (cursor) qs.set('cursor', cursor);
    if (limite != null) qs.set('limite', String(limite));
    const sufixo = qs.toString() ? `?${qs.toString()}` : '';
    return this.requisitar<HistoricoCuponsResponse>(
      'GET',
      `/ingestao/cupons${sufixo}`,
      undefined,
      token,
    );
  }

  /**
   * `DELETE /ingestao/cupom/:id` — PRIVADO: apaga o cupom do próprio usuário no
   * servidor (direito ao apagamento, docs/04). `true` quando apagou; `false` em
   * 404 (já não existe lá — o app pode seguir e limpar o espelho local).
   *
   * O pool anônimo não é afetado: as observações nascem soltas, sem ponteiro de
   * volta ao cupom (decisão travada nº3). A UI diz isso ao usuário.
   */
  async apagarCupom(cupomIdServidor: string): Promise<boolean> {
    const token = await this.resolverToken();
    if (!token) throw new ErroApi(401, 'Sem sessão para apagar o cupom.');
    try {
      await this.requisitar<void>(
        'DELETE',
        `/ingestao/cupom/${encodeURIComponent(cupomIdServidor)}`,
        undefined,
        token,
      );
      return true;
    } catch (e) {
      if (e instanceof ErroApi && e.status === 404) return false;
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
   * `POST /consulta/produtos` (C4.4) — ANÔNIMO. Catálogo da região: busca por
   * termo ou, sem termo, os produtos mais vistos por ali. É o que dá o que fazer
   * a quem ainda não escaneou cupom nenhum (docs/20).
   */
  buscarProdutos(req: BuscaProdutosRequest): Promise<BuscaProdutosResponse> {
    return this.requisitar<BuscaProdutosResponse>('POST', '/consulta/produtos', req);
  }

  /**
   * `POST /consulta/lista` (C12.1) — ANÔNIMO. Compara a cesta entre as lojas do
   * recorte geográfico ("onde minha lista sai mais barata").
   */
  compararLista(req: ComparacaoListaRequest): Promise<ComparacaoListaResponse> {
    return this.requisitar<ComparacaoListaResponse>('POST', '/consulta/lista', req);
  }

  /**
   * `POST /denuncia` (C12.5) — PRIVADO (exige sessão). Reporta que o típico
   * mostrado para um produto na região está errado.
   *
   * O alvo é PRODUTO + GEO, nunca uma observação do pool: não existe ponteiro do
   * usuário para linha anônima (decisão travada #3). Denunciar não publica nada;
   * é sinal para a curadoria.
   */
  denunciarPreco(req: DenunciaPrecoRequest): Promise<DenunciaPrecoResponse> {
    return this.requisitar<DenunciaPrecoResponse>('POST', '/denuncia', req);
  }

  /**
   * `POST /lancamento-manual` (C11.3) — PRIVADO (exige sessão). O usuário viu um
   * preço na prateleira e não tem cupom: informa o EAN + o que leu na etiqueta.
   * Sempre nasce `pendente` — só entra no pool depois de um curador aprovar
   * (fila de moderação, fora do escopo do app). 202.
   *
   * O `usuarioId` fica só no registro PRIVADO de moderação (anti-abuso); o app
   * não precisa (nem pode) mandar isso — o Bearer já basta.
   */
  async lancarPrecoManual(req: LancamentoManualRequest): Promise<LancamentoManualResponse> {
    const token = await this.resolverToken();
    if (!token) throw new ErroApi(401, 'Entre na sua conta para lançar um preço.');
    return this.requisitar<LancamentoManualResponse>('POST', '/lancamento-manual', req, token);
  }

  /** `POST /sync/estatisticas` (C4.2) — ANÔNIMO. Delta desde o cursor. */
  sincronizar(req: DeltaSyncRequest): Promise<DeltaSyncResponse> {
    return this.requisitar<DeltaSyncResponse>('POST', '/sync/estatisticas', req);
  }

  /**
   * `POST /sync/produtos` (C4.5) — ANÔNIMO. Nome/marca/categoria dos ids que o
   * app já tem em cache, para o catálogo ficar navegável sem sinal. Sem cursor:
   * quem sabe o que falta é o app, que pede em lotes.
   */
  sincronizarProdutos(req: SyncProdutosRequest): Promise<SyncProdutosResponse> {
    return this.requisitar<SyncProdutosResponse>('POST', '/sync/produtos', req);
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
    // C10.4 — o id nasce AQUI, antes do envio. Se nascesse no servidor, toda
    // falha que não chega lá (timeout, celular sem rede, backend dormindo) ficaria
    // sem identificador nenhum — e são justamente as que o usuário mais relata.
    const requestId = gerarRequestId();

    const headers: Record<string, string> = {
      Accept: 'application/json',
      [HEADER_REQUEST_ID]: requestId,
    };
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const aborto = new AbortController();
    const timeout = escolherTimeout({
      remoto: ehRemoto(this.baseUrl),
      ultimoContatoEm,
      agora: Date.now(),
    });
    const timer = setTimeout(() => aborto.abort(), timeout);
    let resposta: Response;
    try {
      resposta = await fetch(`${this.baseUrl}${caminho}`, {
        method: metodo,
        headers,
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: aborto.signal,
      });
      // Qualquer resposta — inclusive 4xx/5xx — prova que o processo está no ar.
      ultimoContatoEm = Date.now();
    } catch {
      throw new ErroApi(0, 'Sem conexão com o servidor.', undefined, requestId);
    } finally {
      clearTimeout(timer);
    }

    if (!resposta.ok) {
      let mensagem = `Erro ${resposta.status}.`;
      let codigo: string | undefined;
      // O do corpo tem prioridade sobre o nosso, e o cabeçalho é o plano B para
      // erro sem JSON (502 do proxy, corpo vazio). Só cai no id local quando o
      // servidor não disse nada — aí ele ainda vale para o log do app.
      let idDoServidor = resposta.headers.get(HEADER_REQUEST_ID) ?? undefined;
      try {
        const json = (await resposta.json()) as CorpoErro;
        if (json.erro) mensagem = json.erro;
        codigo = json.codigo;
        idDoServidor = json.requestId ?? idDoServidor;
      } catch {
        // resposta sem corpo JSON — mantém a mensagem padrão.
      }
      throw new ErroApi(resposta.status, mensagem, codigo, idDoServidor ?? requestId);
    }

    if (resposta.status === 204) return undefined as T;
    return (await resposta.json()) as T;
  }
}
