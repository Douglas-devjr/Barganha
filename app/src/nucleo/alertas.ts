/**
 * C8.4 — Motor dos alertas de preço (v1, sem push). Quando o app abre/foca o
 * Início, cada alerta é checado contra o CACHE regional (offline-first): o
 * nível mais específico disponível (município → UF) com base mínima. Dispara
 * quando o preço de referência da região — a MEDIANA (típico) ou o MENOR visto
 * — chegou ao alvo do usuário. Push de verdade (app fechado) é a v2, pós-beta.
 *
 * As regras puras (escolha do nível regional + decisão de disparo) vivem em
 * `alertas-regras.ts`, testáveis sem React Native.
 */

import { alertas, cache } from '@/dados';

import { avaliarAlerta, escolherEstatisticaRegional, type AlertaDisparado } from './alertas-regras';
import { resolverLocalizacao } from './localizacao';

export type { AlertaDisparado } from './alertas-regras';

/** Checa todos os alertas contra o cache regional. Silencioso em erro (é aviso). */
export async function verificarAlertas(): Promise<AlertaDisparado[]> {
  try {
    const [todos, local] = await Promise.all([alertas.listar(), resolverLocalizacao()]);
    if (todos.length === 0 || !local) return [];

    const disparados: AlertaDisparado[] = [];
    for (const alerta of todos) {
      const estatisticas = await cache.listarEstatisticasDoProduto(alerta.produtoCanonicoId);
      const regional = escolherEstatisticaRegional(estatisticas, local);
      const disparo = avaliarAlerta(alerta, regional);
      if (disparo) disparados.push(disparo);
    }
    return disparados;
  } catch {
    return []; // alerta nunca pode quebrar o Início.
  }
}
