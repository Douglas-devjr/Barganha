/**
 * C11.4 — Contrato de OCR para cupons ECF antigos (PLANO B).
 *
 * Decisão travada nº1 (CLAUDE.md): a captura é QR-first (NFC-e via SEFAZ). O OCR
 * de cupons ECF impressos antigos é plano B FUTURO — alguns mercados ainda
 * emitem ECF sem QR consultável. Aqui fica só o SEAM (contrato), análogo ao
 * `ParserSefaz`: imagem → texto cru (MotorOcr) → `NotaEstruturada` (ParserEcf),
 * que então segue pela MESMA anonimização do cupom (C2.4) — nada de paralelo.
 *
 * Nenhum motor está plugado ainda; ver `parser-ecf.ts` (stubs que falham
 * explicitamente em vez de fingir que funcionam).
 */

import type { NotaEstruturada } from '@barganha/shared';

export interface EntradaOcr {
  /** Imagem do cupom em base64 (sem o prefixo `data:`). */
  imagemBase64: string;
  /** Dica de UF, se conhecida — ajuda heurísticas do parser ECF. */
  uf?: string;
}

/** Reconhecimento óptico: imagem do cupom → texto cru. */
export interface MotorOcr {
  reconhecer(entrada: EntradaOcr): Promise<string>;
}

/** Texto OCR de um cupom ECF → `NotaEstruturada` (análogo ao `ParserSefaz`). */
export interface ParserEcf {
  parse(textoOcr: string): NotaEstruturada;
}
