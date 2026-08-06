/**
 * C3.6.2 — Serviço da fila de códigos-loja suspeitos (curadoria).
 *
 * Duas ações, espelhando como o curador realmente decide ao olhar a linha:
 *  • CONFIRMAR — a descrição só variou (abreviação nova, "PROMO" no nome) e o
 *    canônico atual continua certo. Volta a `ativo` sem mudar nada mais.
 *  • REAPONTAR — a loja reciclou o SKU para outro produto físico. O curador
 *    escolhe o canônico certo (mesma busca de `/curadoria/produtos`) e o
 *    mapeamento passa a valer para ELE a partir de agora.
 *
 * Fundir os dois canônicos (quando o "produto certo" nem existia ainda e o
 * item vinha se casando por descrição em dois lugares) é uma decisão
 * DIFERENTE — usa `/curadoria/produto/fundir`, que já existe (C3.6.1). Esta
 * fila só corrige APONTAMENTO, nunca combina séries de preço.
 */

import { LancamentoInvalidoError } from '../erros';
import type {
  ItemFilaCodigoLoja,
  RepositorioFilaCodigoLoja,
  ResultadoReaponte,
} from './tipos-fila-codigo-loja';

/** Tamanho de página quando o curador não pede um número. */
export const LIMITE_FILA_CODIGO_LOJA_PADRAO = 50;
/** Teto de servidor — espelha o mesmo corte das outras filas (C11.3/C12.5). */
export const LIMITE_FILA_CODIGO_LOJA_MAX = 200;

export class ServicoFilaCodigoLoja {
  constructor(private readonly repo: RepositorioFilaCodigoLoja) {}

  /** Fila de curadoria: `status <> 'ativo'`, mais recentes primeiro. */
  listar(limite?: number): Promise<ItemFilaCodigoLoja[]> {
    const limiteValido = Math.min(
      Math.max(Math.trunc(limite ?? LIMITE_FILA_CODIGO_LOJA_PADRAO), 1),
      LIMITE_FILA_CODIGO_LOJA_MAX,
    );
    return this.repo.listarSuspeitos(limiteValido);
  }

  /** `false` = o par (loja, código) não existe (HTTP 404). */
  async confirmar(lojaCnpj: string, codigo: string): Promise<boolean> {
    if (!lojaCnpj?.trim() || !codigo?.trim()) {
      throw new LancamentoInvalidoError('lojaCnpj e codigo são obrigatórios.');
    }
    return this.repo.confirmarMapeamento(lojaCnpj, codigo);
  }

  async reapontar(
    lojaCnpj: string,
    codigo: string,
    produtoCanonicoId: string,
  ): Promise<ResultadoReaponte> {
    if (!lojaCnpj?.trim() || !codigo?.trim() || !produtoCanonicoId?.trim()) {
      throw new LancamentoInvalidoError('lojaCnpj, codigo e produtoCanonicoId são obrigatórios.');
    }
    return this.repo.reapontarMapeamento(lojaCnpj, codigo, produtoCanonicoId);
  }
}
