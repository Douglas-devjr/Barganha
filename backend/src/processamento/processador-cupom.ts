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
  PayloadQrInvalidoError,
} from '../erros';
import type { Anonimizador } from '../anonimizacao/anonimizador';
import type { Telemetria } from '../observabilidade/telemetria';
import { telemetriaNula } from '../observabilidade/telemetria';
import { pareceDefesaAntiBot } from '../parsers/html';
import { parseQrNfce, type QrNfce } from '../parsers/qr-payload';
import type { RegistroParsers } from '../parsers/registro';
import type { ParserSefaz } from '../parsers/tipos';
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
    if (cupom.status === 'processado') return;
    if (pareceDefesaAntiBot(html)) {
      throw new HtmlDesafioError(
        'O HTML enviado ainda é a página de bloqueio/desafio da SEFAZ, não a nota.',
      );
    }

    let uf = cupom.uf;
    try {
      const qr = parseQrNfce(cupom.qrPayload);
      uf = qr.uf ?? cupom.uf;

      const alvo = this.resolverParser(uf);
      if (!alvo) return; // sem parser ou UF fora do rollout — represado (C2.5).

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

    await this.repo.marcarProcessado(cupom.id, {
      loja: resultado.loja,
      emitidoEm: resultado.emitidoEm,
      uf,
      itensPrivados: resultado.itensPrivados,
      observacoes: resultado.observacoes,
      // Totais do cupom (desconto/pago) persistem no CUPOM privado: o app os
      // recebe também pelo polling do caminho servidor, não só pelo HTML (C2.6).
      ...(nota.total ? { total: nota.total } : {}),
    });
    this.telemetria.registrarParsing(uf, 'processado');

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
