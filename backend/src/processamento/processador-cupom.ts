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

import type { NotaEstruturada, TotaisNota } from '@barganha/shared';

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
import { parseQrNfce } from '../parsers/qr-payload';
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

export interface OpcoesProcessador {
  /** Gate de lançamento faseado (C10.3). Omitido → todas as UFs habilitadas. */
  rollout?: Rollout;
  /** Observabilidade por estado (C10.2). Omitido → no-op. */
  telemetria?: Telemetria;
}

export class ProcessadorCupom {
  private readonly rollout: Rollout;
  private readonly telemetria: Telemetria;

  constructor(
    private readonly repo: RepositorioCupom,
    private readonly registro: RegistroParsers,
    private readonly anonimizador: Anonimizador,
    opcoes: OpcoesProcessador = {},
  ) {
    this.rollout = opcoes.rollout ?? ROLLOUT_TUDO;
    this.telemetria = opcoes.telemetria ?? telemetriaNula;
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
  async processarComHtml(cupom: CupomRegistro, html: string): Promise<TotaisNota | undefined> {
    if (cupom.status === 'processado') return undefined;
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
      if (!alvo) return undefined; // sem parser ou UF fora do rollout — represado (C2.5).

      const nota = alvo.parseHtml(html);
      await this.finalizar(cupom, uf!, nota);
      // Totais do cupom (bruto/desconto/pago) voltam para o app exibir — não são
      // persistidos no servidor (histórico privado é local-first, docs/05).
      return nota.total;
    } catch (erro) {
      await this.tratarErro(cupom.id, uf, erro);
      return undefined;
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
    });
    this.telemetria.registrarParsing(uf, 'processado');
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
