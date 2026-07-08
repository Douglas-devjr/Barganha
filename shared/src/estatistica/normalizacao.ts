/**
 * C3/C7 — Normalização de preço para a unidade-base comparável (R$/kg, R$/L,
 * R$/un). Nunca se compara valor cru (decisão travada / docs/06).
 *
 * Mora em `shared/` de propósito: o MESMO mapa de unidades normaliza o preço no
 * backend (ao montar `observacao_preco`, C2.4) e no app (ao classificar o preço
 * de prateleira offline e ao montar a faixa pessoal, C7) — sem divergência.
 *
 * Usa o preço UNITÁRIO marcado na NFC-e (não o total/quantidade): o veredito
 * compara contra o preço regular de prateleira; a promoção é tratada à parte
 * via `emPromocao` (docs/06). Normalização por TAMANHO de pacote (ex.: R$/kg de
 * um "ARROZ 5KG" vendido por UN) é enriquecimento futuro (C11.5).
 */

import type { UnidadeBase } from '../core';

export interface PrecoNormalizado {
  unidadeBase: UnidadeBase;
  /** Preço já em R$/unidade_base. */
  precoNormalizado: number;
}

/**
 * unidade da NFC-e → { base comparável, fator p/ converter o preço unitário }.
 * Conservador de propósito: só unidades inequívocas. Ampliar/calibrar com dados
 * reais em C3.4 (ex.: CX/PCT/FD e packs, que hoje ficam fora do pool).
 */
export const MAPA_UNIDADES: Readonly<Record<string, { base: UnidadeBase; fator: number }>> = {
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
  // Embalagens vendidas como UMA peça (vistas em cupons reais do RJ): bandeja,
  // envelope, frasco e pote. Diferente de CX/FD (packs com N unidades dentro),
  // aqui 1 volume = 1 item vendido — mesmo racional do UN.
  BJ: { base: 'un', fator: 1 },
  EV: { base: 'un', fator: 1 },
  FR: { base: 'un', fator: 1 },
  PT: { base: 'un', fator: 1 },
};

/** Arredonda para 4 casas (evita ruído de ponto flutuante no R$/base). */
function arredondar(valor: number): number {
  return Math.round(valor * 1e4) / 1e4;
}

/**
 * Converte o preço unitário de um item para a unidade-base. Retorna `undefined`
 * quando a unidade é desconhecida ou o preço é inválido — nesse caso o item NÃO
 * entra no pool compartilhado (fica só no histórico privado) e a UI o ignora no
 * veredito.
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

/**
 * Unidade de venda canônica de uma unidade-base (R$/kg → "KG", etc.). Útil na
 * gôndola (C7): quando o usuário digita o preço de prateleira de um produto
 * cuja base é conhecida mas sem unidade explícita, assume-se a venda na própria
 * base (fator 1) — ex.: pacote vendido por UN, carne por KG.
 */
export function unidadePadraoDaBase(base: UnidadeBase): string {
  switch (base) {
    case 'kg':
      return 'KG';
    case 'L':
      return 'L';
    case 'un':
      return 'UN';
  }
}

/** Normaliza descrição p/ casamento/canônico: sem acento, maiúsculas, 1 espaço. */
export function normalizarDescricao(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chave canônica de um município (`UF:MUNICIPIO`) — o `escopo_id` do nível
 * `municipio` em `preco_estatistica`. FONTE ÚNICA usada na ESCRITA (pipeline, ao
 * derivar escopos) e na LEITURA (consulta/sync do app): o município nasce cru do
 * endereço da nota (o parser gera `"SAO PAULO"`, caixa alta sem acento) e um
 * seletor de cidade produz `"São Paulo"` — normalizar os dois lados pelo mesmo
 * `normalizarDescricao` garante que casem. `''` quando falta UF ou município.
 */
export function chaveMunicipio(uf: string, municipio: string): string {
  const u = uf.trim().toUpperCase();
  const m = normalizarDescricao(municipio);
  return u && m ? `${u}:${m}` : '';
}
