/**
 * @barganha/shared — tipos e utilitários compartilhados entre app e backend.
 *
 * Por enquanto é a fundação (C0). Os contratos de domínio (`NotaEstruturada`,
 * DTOs de API) entram na Camada 1 (C1.3).
 */

export const BARGANHA = {
  nome: 'Barganha',
  /** Versão do contrato compartilhado (app ↔ backend). */
  versaoContrato: '0.0.0',
} as const;

/** Unidade-base de comparação de preço (nunca comparar valor cru). */
export type UnidadeBase = 'kg' | 'L' | 'un';

/**
 * Garante exaustividade em `switch` sobre uniões (parsers por estado,
 * escopos de estatística, etc.). Falha em tempo de compilação se um caso
 * novo não for tratado.
 */
export function assertNever(valor: never): never {
  throw new Error(`Caso não tratado: ${String(valor)}`);
}
