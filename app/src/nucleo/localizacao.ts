/**
 * C7 — Localização do usuário para o recorte REGIONAL de preço.
 *
 * Uma fonte única de "onde comparar": a cidade/UF ESCOLHIDA manualmente na Perfil
 * tem prioridade; na ausência dela, cai na UF do último cupom (derivada da LOJA,
 * nunca do usuário — decisão travada #4). É o que permite o veredito da gôndola
 * ter região mesmo para quem ainda não escaneou nenhum cupom.
 *
 * A localização mora só no aparelho e serve apenas para recortar a consulta/sync
 * ANÔNIMOS — nunca viaja junto com dado privado.
 */

import { chaveMunicipio } from '@barganha/shared';

import { meta, produtos } from '@/dados';

export interface LocalizacaoEfetiva {
  uf: string;
  municipio?: string;
}

/** As 27 unidades federativas — opções do seletor de região (Perfil/onboarding). */
export const UFS: readonly string[] = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

/**
 * Localização efetiva: a escolhida manualmente `??` a UF do histórico. `null`
 * quando não há escolha nem cupom com UF — aí ainda não há região para consultar.
 */
export async function resolverLocalizacao(): Promise<LocalizacaoEfetiva | null> {
  const escolhido = await meta.obterLocalEscolhido();
  if (escolhido) return escolhido;
  const uf = await produtos.obterUfRecente();
  return uf ? { uf } : null;
}

/**
 * Chaves de `escopo_id` para o delta sync: a do MUNICÍPIO (quando há) + a da UF
 * como fallback. O sync filtra `escopo_id` diretamente (docs/05), então a chave
 * de município já vai canônica (`chaveMunicipio`, a mesma da escrita no backend).
 */
export function escoposSync(local: LocalizacaoEfetiva): string[] {
  const chaves: string[] = [];
  if (local.municipio) {
    const chave = chaveMunicipio(local.uf, local.municipio);
    if (chave) chaves.push(chave);
  }
  const uf = local.uf.trim().toUpperCase();
  if (uf) chaves.push(uf);
  return chaves;
}
