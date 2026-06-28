/**
 * Normalização de preço para a unidade-base comparável (R$/kg, R$/L, R$/un).
 * Nunca se compara valor cru (decisão travada / docs/06).
 *
 * Usa o preço UNITÁRIO marcado na NFC-e (não o total/quantidade): o veredito
 * compara contra o preço regular de prateleira; a promoção é tratada à parte
 * via `em_promocao` (docs/06). Normalização por tamanho de pacote (ex.: R$/kg
 * de um "ARROZ 5KG" vendido por UN) é enriquecimento futuro (C11.5).
 */

import { type UnidadeBase } from '@barganha/shared';

export interface PrecoNormalizado {
  unidadeBase: UnidadeBase;
  /** Preço já em R$/unidade_base. */
  precoNormalizado: number;
}

/** unidade da NFC-e → { base comparável, fator p/ converter o preço unitário }. */
const MAPA_UNIDADES: Readonly<Record<string, { base: UnidadeBase; fator: number }>> = {
  KG: { base: 'kg', fator: 1 },
  KGS: { base: 'kg', fator: 1 },
  KILO: { base: 'kg', fator: 1 },
  QUILO: { base: 'kg', fator: 1 },
  G: { base: 'kg', fator: 1000 },
  GR: { base: 'kg', fator: 1000 },
  GRS: { base: 'kg', fator: 1000 },
  GRAMA: { base: 'kg', fator: 1000 },
  GRAMAS: { base: 'kg', fator: 1000 },
  L: { base: 'L', fator: 1 },
  LT: { base: 'L', fator: 1 },
  LTS: { base: 'L', fator: 1 },
  LITRO: { base: 'L', fator: 1 },
  LITROS: { base: 'L', fator: 1 },
  ML: { base: 'L', fator: 1000 },
  UN: { base: 'un', fator: 1 },
  UND: { base: 'un', fator: 1 },
  UNID: { base: 'un', fator: 1 },
  UNIDADE: { base: 'un', fator: 1 },
  PC: { base: 'un', fator: 1 },
  PÇ: { base: 'un', fator: 1 },
  DZ: { base: 'un', fator: 1 / 12 },
  DUZIA: { base: 'un', fator: 1 / 12 },
};

/** Arredonda para 4 casas (evita ruído de ponto flutuante no R$/base). */
function arredondar(valor: number): number {
  return Math.round(valor * 1e4) / 1e4;
}

/**
 * Converte o preço unitário do item para a unidade-base. Retorna `undefined`
 * quando a unidade é desconhecida ou o preço é inválido — nesse caso o item
 * NÃO entra no pool compartilhado (fica só no histórico privado).
 */
export function normalizarPreco(item: {
  unidade: string;
  valorUnitario: number;
}): PrecoNormalizado | undefined {
  const chave = item.unidade.normalize('NFC').toUpperCase().trim();
  const mapeado = MAPA_UNIDADES[chave];
  if (!mapeado) return undefined;
  if (!Number.isFinite(item.valorUnitario) || item.valorUnitario <= 0) return undefined;

  return {
    unidadeBase: mapeado.base,
    precoNormalizado: arredondar(item.valorUnitario * mapeado.fator),
  };
}

/** Normaliza descrição para casamento/canônico: sem acento, maiúsculas, 1 espaço. */
export function normalizarDescricao(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
