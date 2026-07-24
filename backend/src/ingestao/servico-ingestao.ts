/**
 * C2.1 — Serviço de ingestão de QR.
 *
 * Recebe só o conteúdo cru do QR (parsing roda no backend, nunca no app) e:
 *  1. valida/extrai a chave e a UF (sem tocar a SEFAZ);
 *  2. grava o cupom como `qr_capturado` de forma IDEMPOTENTE por chave — o QR
 *     cru é guardado de QUALQUER estado desde o dia 1 (docs/03);
 *  3. enfileira o processamento assíncrono (a resposta não espera o parsing).
 *
 * A UF sem parser NÃO é erro aqui: o cupom fica guardado para reprocessamento
 * retroativo (C2.5). Erros só acontecem se o QR/chave forem inválidos.
 */

import type { CupomResponse, IngestaoQrRequest, IngestaoQrResponse } from '@barganha/shared';

import type { FilaProcessamento } from '../fila/tipos';
import { parseQrNfce } from '../parsers/qr-payload';
import type { CupomRegistro, RepositorioCupom } from '../persistencia/tipos';

/**
 * Porta mínima para o processamento a partir de HTML colhido pelo app (C2.6).
 * Mantém a ingestão desacoplada do `ProcessadorCupom` concreto (só o composition
 * root os liga) e trivial de testar com um fake. Os totais do cupom
 * (desconto/pago) são persistidos no próprio cupom e voltam via `obterCupom`.
 */
export interface ProcessadorHtml {
  processarComHtml(cupom: CupomRegistro, html: string): Promise<void>;
}

export class ServicoIngestao {
  constructor(
    private readonly repo: RepositorioCupom,
    private readonly fila: FilaProcessamento,
    /**
     * Processador para a ingestão por HTML (C2.6). Opcional: só o caminho
     * `ingerirHtml` o exige — a ingestão de QR não depende dele, então os
     * cenários que só usam QR seguem construindo o serviço com 2 argumentos.
     */
    private readonly processador?: ProcessadorHtml,
  ) {}

  async ingerir(usuarioId: string, req: IngestaoQrRequest): Promise<IngestaoQrResponse> {
    const qr = parseQrNfce(req.qrPayload);

    const resultado = await this.repo.criarOuObterPorChave({
      usuarioId,
      chaveAcesso: qr.chave.valor,
      uf: qr.uf,
      qrPayload: qr.payloadCru,
      capturadoEm: req.capturadoEm,
    });

    // Enfileira no primeiro envio ou quando um envio anterior falhou (retry do
    // cliente). Cupons já `processado`/`qr_capturado` em andamento não são
    // re-enfileirados — evita reprocessar e duplicar no pool.
    if (resultado.novo || resultado.status === 'falha') {
      await this.fila.enfileirar({ cupomId: resultado.cupomId, uf: qr.uf });
    }

    // A chave volta na resposta: o app a grava no espelho local e a idempotência
    // local por chave (índice único, docs/05) passa a valer no aparelho.
    return { cupomId: resultado.cupomId, status: resultado.status, chaveAcesso: qr.chave.valor };
  }

  /**
   * C2.6 — Ingestão por HTML: o app colheu o HTML da nota renderizada (via
   * WebView, quando o portal exige navegador/reCAPTCHA) e o envia para o backend
   * PARSEAR (decisão travada nº2: parsing nunca no app). Escopo do DONO: cupom de
   * outro usuário ou inexistente → `undefined` (a HTTP traduz para 404, sem vazar
   * existência). Propaga `HtmlDesafioError` quando o HTML ainda é a página de
   * desafio — a HTTP traduz para 4xx e o app reabre/reenvia. Devolve o estado
   * atualizado do cupom (já `processado`, com os itens) para o app espelhar.
   */
  async ingerirHtml(
    usuarioId: string,
    cupomId: string,
    html: string,
  ): Promise<CupomResponse | undefined> {
    if (!this.processador) {
      throw new Error('Ingestão por HTML indisponível: processador não configurado.');
    }
    const cupom = await this.repo.obterParaProcessamento(cupomId);
    if (!cupom || cupom.usuarioId !== usuarioId) return undefined;

    await this.processador.processarComHtml(cupom, html);
    // Os totais (desconto/pago) foram persistidos no cupom pelo processamento;
    // `obterCupom` já os devolve — mesmo caminho do polling (C6.3).
    return this.obterCupom(usuarioId, cupomId);
  }

  /**
   * Apaga um cupom do PRÓPRIO usuário (direito ao apagamento, docs/04).
   * `false` quando não existe ou é de outro dono → a HTTP traduz para 404.
   *
   * O pool anônimo NÃO é afetado, e isso é o desenho, não uma limitação: as
   * observações nascem soltas, sem `usuario_id` nem `cupom_id` (decisão travada
   * nº3), então não existe caminho de volta do cupom para elas. A UI precisa
   * dizer isso ao usuário — apagar o histórico é dele; o preço já compartilhado
   * é anônimo e segue servindo a base.
   */
  apagarCupom(usuarioId: string, cupomId: string): Promise<boolean> {
    return this.repo.apagarDoUsuario(cupomId, usuarioId);
  }

  /**
   * C6.3 — Estado de um cupom do PRÓPRIO usuário (privado). O app consulta para
   * acompanhar o parsing assíncrono e exibir os itens. `undefined` quando o
   * cupom não existe ou é de outro dono — a camada HTTP traduz para 404.
   */
  async obterCupom(usuarioId: string, cupomId: string): Promise<CupomResponse | undefined> {
    const cupom = await this.repo.obterDoUsuario(cupomId, usuarioId);
    if (!cupom) return undefined;
    return {
      cupomId: cupom.cupomId,
      status: cupom.status,
      ...(cupom.emitidoEm ? { emitidoEm: cupom.emitidoEm } : {}),
      ...(cupom.uf ? { uf: cupom.uf } : {}),
      ...(cupom.loja ? { loja: cupom.loja } : {}),
      ...(cupom.descontoTotal != null ? { descontoTotal: cupom.descontoTotal } : {}),
      ...(cupom.valorPago != null ? { valorPago: cupom.valorPago } : {}),
      itens: cupom.itens.map((i) => ({
        ...(i.produtoCanonicoId ? { produtoCanonicoId: i.produtoCanonicoId } : {}),
        descricaoOriginal: i.descricaoOriginal,
        ...(i.ean ? { ean: i.ean } : {}),
        quantidade: i.quantidade,
        unidade: i.unidade,
        valorUnitario: i.valorUnitario,
        valorTotal: i.valorTotal,
        ...(i.desconto != null ? { desconto: i.desconto } : {}),
      })),
    };
  }
}
