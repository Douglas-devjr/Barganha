/**
 * Processador de cupom (worker da fila). Conduz o ciclo de status do cupom:
 *   qr_capturado → (parser disponível? UF habilitada?) → processado | falha
 *
 * Decisões de retry (a fila só repete quando ESTE método LANÇA):
 *  • UF sem parser → retorna sem lançar e SEM mudar status: o cupom fica
 *    `qr_capturado` aguardando reprocessamento retroativo (C2.5).
 *  • UF com parser mas FORA do rollout (C10.3) → idem: fica `qr_capturado` até a
 *    UF ser habilitada; o reprocessamento retroativo a recupera.
 *  • Erro PERMANENTE (layout/parse, QR inválido) → marca `falha`, não lança.
 *  • Erro TRANSITÓRIO (portal fora do ar, rede, banco) → lança: a fila dá
 *    retry com backoff.
 *
 * Cada desfecho é registrado na telemetria por estado (C10.2).
 */

import type { NotaEstruturada } from '@barganha/shared';

import {
  ChaveAcessoInvalidaError,
  FalhaParserSefazError,
  HtmlDesafioError,
  HtmlErroPortalError,
  PayloadQrInvalidoError,
} from '../erros';
import type { Anonimizador } from '../anonimizacao/anonimizador';
import type { Telemetria } from '../observabilidade/telemetria';
import { telemetriaNula } from '../observabilidade/telemetria';
import { pareceDefesaAntiBot, pareceErroPortal } from '../parsers/html';
import { parseQrNfce, type QrNfce } from '../parsers/qr-payload';
import type { RegistroParsers } from '../parsers/registro';
import type { ParserSefaz } from '../parsers/tipos';
import { hashChavePool } from '../persistencia/tipos';
import type { CupomRegistro, RepositorioCupom } from '../persistencia/tipos';
import type { Rollout } from '../rollout/controle-rollout';
import { ROLLOUT_TUDO } from '../rollout/controle-rollout';

/** Erros que NÃO adianta repetir — corrigir o parser, não tentar de novo. */
function ehErroPermanente(erro: unknown): boolean {
  return (
    erro instanceof FalhaParserSefazError ||
    erro instanceof PayloadQrInvalidoError ||
    erro instanceof ChaveAcessoInvalidaError
  );
}

/**
 * Integridade: a nota parseada precisa SER a nota da chave de acesso. A chave
 * carrega o CNPJ do emitente (posições 6–20), então uma nota cujo CNPJ não bate
 * é outra nota — HTML da página errada no WebView ou conteúdo forjado tentando
 * envenenar o pool (C9.2). Erro permanente: marca `falha`, não adianta retry.
 */
function validarNotaContraChave(qr: QrNfce, nota: NotaEstruturada): void {
  if (nota.loja.cnpj !== qr.chave.cnpj) {
    throw new FalhaParserSefazError(
      `CNPJ do emitente na nota (${nota.loja.cnpj}) não corresponde ao da chave de acesso (${qr.chave.cnpj}).`,
    );
  }
}

export interface OpcoesProcessador {
  /** Gate de lançamento faseado (C10.3). Omitido → todas as UFs habilitadas. */
  rollout?: Rollout;
  /** Observabilidade por estado (C10.2). Omitido → no-op. */
  telemetria?: Telemetria;
  /**
   * C3 — gatilho de recálculo da estatística após o cupom entrar no pool. Recebe
   * os `produto_canonico_id` que ganharam observação; o composition root o liga
   * ao `PipelineEstatistica`. Omitido → a estatística não é recalculada aqui (o
   * `preco_estatistica` só se atualizaria por um job em lote). É o que faltava
   * para o veredito na gôndola ter dados: sem este disparo, o pool enche mas a
   * mediana/faixa nunca é construída.
   */
  aoPublicarPool?: (produtoCanonicoIds: string[]) => Promise<void>;
}

export class ProcessadorCupom {
  private readonly rollout: Rollout;
  private readonly telemetria: Telemetria;
  private readonly aoPublicarPool?: (produtoCanonicoIds: string[]) => Promise<void>;

  constructor(
    private readonly repo: RepositorioCupom,
    private readonly registro: RegistroParsers,
    private readonly anonimizador: Anonimizador,
    opcoes: OpcoesProcessador = {},
  ) {
    this.rollout = opcoes.rollout ?? ROLLOUT_TUDO;
    this.telemetria = opcoes.telemetria ?? telemetriaNula;
    this.aoPublicarPool = opcoes.aoPublicarPool;
  }

  async processar(cupomId: string): Promise<void> {
    const cupom = await this.repo.obterParaProcessamento(cupomId);
    if (!cupom || cupom.status === 'processado') return;

    // Mantida fora do try para a telemetria de falha saber a UF (cUF da chave).
    let uf = cupom.uf;
    try {
      const qr = parseQrNfce(cupom.qrPayload);
      uf = qr.uf ?? cupom.uf;

      const alvo = this.resolverParser(uf);
      if (!alvo) return; // sem parser ou UF fora do rollout — represado (C2.5).

      // Busca na SEFAZ + parse. UF da chave (cUF) é canônica — mais confiável
      // que o endereço parseado.
      const nota = await alvo.parse(qr);
      validarNotaContraChave(qr, nota);
      await this.finalizar(cupom, uf!, nota);
    } catch (erro) {
      await this.tratarErro(cupom.id, uf, erro);
    }
  }

  /**
   * C2.6 — Processa a partir de um HTML JÁ OBTIDO (colhido pelo próprio app via
   * WebView, quando o portal exige navegador/reCAPTCHA). Mesma lógica de
   * `processar`, mas sem tocar a rede. O cupom já vem carregado (o serviço checou
   * o dono). Lança `HtmlDesafioError` se o HTML ainda for a página de
   * bloqueio/desafio — nesse caso o app reabre e reenvia (não marca `falha`).
   */
  async processarComHtml(cupom: CupomRegistro, html: string): Promise<void> {
    if (pareceDefesaAntiBot(html)) {
      throw new HtmlDesafioError(
        'O HTML enviado ainda é a página de bloqueio/desafio da SEFAZ, não a nota.',
      );
    }
    // Portal RECUSOU a verificação (reCAPTCHA de pontuação baixa) e caiu na
    // página de erro. É transitório — o app recarrega a consulta (token novo)
    // e tenta de novo. Antes desta checagem o HTML seguia para o parser, virava
    // `FalhaParserSefazError` e o cupom era marcado `falha` PERMANENTE mesmo
    // quando a tentativa seguinte passaria.
    if (pareceErroPortal(html)) {
      this.telemetria.registrarParsing(cupom.uf, 'erro_portal');
      throw new HtmlErroPortalError(
        'O portal da SEFAZ recusou a verificação. Recarregue a consulta e tente de novo.',
      );
    }
    // Cupom JÁ processado: nunca re-publica itens/pool. Mas cupons processados
    // ANTES do recurso de totais ficaram sem desconto/pago para sempre (o retro
    // C2.5 não alveja `processado`) — este é o único caminho de backfill.
    if (cupom.status === 'processado') {
      await this.backfillTotais(cupom, html);
      return;
    }

    let uf = cupom.uf;
    try {
      const qr = parseQrNfce(cupom.qrPayload);
      uf = qr.uf ?? cupom.uf;

      const alvo = this.resolverParser(uf);
      if (!alvo) return; // sem parser ou UF fora do rollout — represado (C2.5).

      // O coletor manda o DOM do MOMENTO (a cada poucos segundos): páginas de
      // transição/intermediárias não podem virar `falha` permanente. Se o parser
      // sabe reconhecer sua nota e este HTML ainda não é uma, seguimos aguardando.
      if (alvo.pareceNota && !alvo.pareceNota(html)) {
        throw new HtmlDesafioError('O HTML enviado ainda não é a página da nota.');
      }

      const nota = alvo.parseHtml(html);
      validarNotaContraChave(qr, nota);
      await this.finalizar(cupom, uf!, nota);
    } catch (erro) {
      await this.tratarErro(cupom.id, uf, erro);
    }
  }

  /**
   * Resolve o parser da UF aplicando os gates de rollout (C10.3). Devolve
   * `undefined` (represa o cupom em `qr_capturado` p/ reprocessamento retroativo,
   * C2.5) quando não há parser ou a UF ainda não entrou no lançamento.
   */
  private resolverParser(uf: string | undefined): ParserSefaz | undefined {
    if (!uf || !this.registro.suporta(uf)) {
      this.telemetria.registrarParsing(uf, 'sem_parser');
      return undefined;
    }
    if (!this.rollout.habilitada(uf)) {
      this.telemetria.registrarParsing(uf, 'uf_nao_habilitada');
      return undefined;
    }
    return this.registro.resolver(uf);
  }

  /** Anonimiza (docs/04) e grava nota privada + pool; marca `processado`. */
  private async finalizar(cupom: CupomRegistro, uf: string, nota: NotaEstruturada): Promise<void> {
    const resultado = await this.anonimizador.anonimizar(
      nota,
      {
        usuarioId: cupom.usuarioId,
        cupomId: cupom.id,
        ...(cupom.chaveAcesso ? { chaveAcesso: cupom.chaveAcesso } : {}),
      },
      uf,
    );

    const { poolPublicado } = await this.repo.marcarProcessado(cupom.id, {
      loja: resultado.loja,
      emitidoEm: resultado.emitidoEm,
      uf,
      itensPrivados: resultado.itensPrivados,
      observacoes: resultado.observacoes,
      // Totais do cupom (desconto/pago) persistem no CUPOM privado: o app os
      // recebe também pelo polling do caminho servidor, não só pelo HTML (C2.6).
      ...(nota.total ? { total: nota.total } : {}),
      // C9.2.1 — dedup global do pool: a mesma chave (outra conta) não publica
      // duas vezes. O histórico privado do usuário existe normalmente.
      ...(cupom.chaveAcesso ? { chaveHash: hashChavePool(cupom.chaveAcesso) } : {}),
    });
    this.telemetria.registrarParsing(uf, 'processado');
    if (!poolPublicado && resultado.observacoes.length > 0) {
      // Observações retidas (chave já publicada): conta para a operação
      // enxergar o volume — pico sustentado = abuso ativo (C9.2.1).
      this.telemetria.registrarParsing(uf, 'pool_deduplicado');
      return;
    }

    // C3 — o pool já foi gravado (transação da RPC commitada). Dispara o
    // recálculo da mediana/faixa dos produtos afetados para o veredito na gôndola
    // ter dados. Best-effort: a observação já está persistida; um erro aqui NÃO
    // pode desfazer a ingestão nem relançar (o retry cairia no guard de
    // `processado` e o recálculo nunca aconteceria) — apenas registra para um
    // job em lote recuperar depois.
    const produtoIds = [...new Set(resultado.observacoes.map((o) => o.produtoCanonicoId))];
    if (produtoIds.length > 0 && this.aoPublicarPool) {
      try {
        await this.aoPublicarPool(produtoIds);
      } catch (erro) {
        console.error(`Falha ao recalcular estatística após cupom ${cupom.id}:`, erro);
      }
    }
  }

  /**
   * C2.6 — Backfill dos TOTAIS de um cupom já `processado` (o repositório só
   * grava se `valor_pago` ainda for nulo). Qualquer falha vira `HtmlDesafioError`
   * (422 — o coletor segue aguardando/tentando): um cupom processado JAMAIS pode
   * regredir a `falha` por causa de um HTML ruim.
   */
  private async backfillTotais(cupom: CupomRegistro, html: string): Promise<void> {
    try {
      const qr = parseQrNfce(cupom.qrPayload);
      const uf = qr.uf ?? cupom.uf;
      // Direto no registro, SEM gate de rollout: a UF já foi processada um dia.
      const alvo = uf && this.registro.suporta(uf) ? this.registro.resolver(uf) : undefined;
      if (!alvo) return;
      if (alvo.pareceNota && !alvo.pareceNota(html)) {
        throw new HtmlDesafioError('O HTML enviado ainda não é a página da nota.');
      }
      const nota = alvo.parseHtml(html);
      validarNotaContraChave(qr, nota);
      if (nota.total) await this.repo.atualizarTotais(cupom.id, nota.total);
    } catch (erro) {
      if (erro instanceof HtmlDesafioError) throw erro;
      throw new HtmlDesafioError('Não foi possível ler os totais desta nota ainda.');
    }
  }

  /** Erro permanente → marca `falha` (com log). Transitório → relança (retry). */
  private async tratarErro(cupomId: string, uf: string | undefined, erro: unknown): Promise<void> {
    if (ehErroPermanente(erro)) {
      this.telemetria.registrarParsing(uf, 'falha_permanente');
      const motivo = erro instanceof Error ? erro.message : String(erro);
      // Observabilidade: o motivo não é persistido no cupom; sem este log a
      // falha permanente fica invisível para diagnóstico (C10.2).
      console.error(`Falha permanente ao processar cupom ${cupomId} (${uf ?? '??'}): ${motivo}`);
      await this.repo.marcarFalha(cupomId, motivo);
      return;
    }
    throw erro; // transitório → a fila dá retry com backoff
  }
}
