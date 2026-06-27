/**
 * Primitivas do contrato compartilhado (app ↔ backend).
 */

export const BARGANHA = {
  nome: 'Barganha',
  /** Versão do contrato compartilhado (app ↔ backend). v1 = Camada 1 (C1). */
  versaoContrato: '1.0.0',
} as const;

/** Unidade-base de comparação de preço (nunca comparar valor cru). */
export const UNIDADES_BASE = ['kg', 'L', 'un'] as const;
export type UnidadeBase = (typeof UNIDADES_BASE)[number];

/** Type guard de unidade-base — útil em parsers e na anonimização. */
export function eUnidadeBase(valor: unknown): valor is UnidadeBase {
  return UNIDADES_BASE.includes(valor as UnidadeBase);
}

/**
 * Garante exaustividade em `switch` sobre uniões (parsers por estado,
 * escopos de estatística, etc.). Falha em tempo de compilação se um caso
 * novo não for tratado.
 */
export function assertNever(valor: never): never {
  throw new Error(`Caso não tratado: ${String(valor)}`);
}
