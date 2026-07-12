/**
 * Registro das redes VTEX habilitadas — vem do ambiente (`REDES_VTEX`), nunca
 * do código: adicionar/remover uma rede (ex.: a pedido dela) é editar a env.
 *
 * Formato (JSON): [{"id":"zonasul","nome":"Zona Sul","dominio":"www.zonasul.com.br"}]
 * Vazio/ausente/inválido → [] (a coleta simplesmente não roda — feature off).
 */

import type { RedeVtex } from './vtex/tipos';

export function parseRedesVtex(bruto: string | undefined): RedeVtex[] {
  if (!bruto || bruto.trim() === '') return [];
  try {
    const dados: unknown = JSON.parse(bruto);
    if (!Array.isArray(dados)) return [];
    return dados.filter(
      (r): r is RedeVtex =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as RedeVtex).id === 'string' &&
        typeof (r as RedeVtex).nome === 'string' &&
        typeof (r as RedeVtex).dominio === 'string' &&
        (r as RedeVtex).dominio.length > 0,
    );
  } catch {
    console.error('[redes] REDES_VTEX inválido (esperado JSON array) — nenhuma rede habilitada.');
    return [];
  }
}
