/**
 * Orquestração do feed de notificações (redesign 3a). Junta o que o app já
 * calcula — alertas disparados, selos de contribuição, economia por mês — e
 * grava como eventos persistidos, para a tela de Notificações ter de onde ler.
 *
 * Roda junto com a checagem de alertas (foco do Início). É idempotente: as
 * regras puras em `notificacoes-regras.ts` dão a chave de dedupe, e o
 * repositório ignora o que já existe — focar o Início 20× não gera 20 avisos.
 *
 * Silencioso em erro, como o motor de alertas: notificação é um extra, nunca
 * pode derrubar o Início.
 */

import { cupons, notificacoes } from '@/dados';

import type { AlertaDisparado } from './alertas-regras';
import { calcularContribuicao } from './gamificacao';
import { deAlerta, deResumoMensal, deSelos, mesLocal } from './notificacoes-regras';

/**
 * Registra os eventos novos a partir do estado atual. Recebe os disparos já
 * calculados (evita checar os alertas duas vezes no mesmo foco).
 *
 * @returns quantos eventos NOVOS entraram no feed.
 */
export async function sincronizarFeed(
  disparos: AlertaDisparado[],
  agora = new Date(),
): Promise<number> {
  try {
    const eventos = [...disparos.map((d) => deAlerta(d, agora))];

    // Selos: recalculados do histórico local (só cupons processados); a chave
    // por selo evita duplicar.
    const datas = await cupons.listarDatasContribuicao();
    eventos.push(...deSelos(calcularContribuicao(datas, agora).selos, agora));

    // Resumo do mês ANTERIOR — só faz sentido quando o mês já fechou.
    const anterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
    const mesAlvo = mesLocal(anterior);
    const porMes = await cupons.economiaPorMes(12);
    const doMes = porMes.find((m) => m.mes === mesAlvo);
    if (doMes) {
      const resumo = deResumoMensal(mesAlvo, doMes.economia, agora);
      if (resumo) eventos.push(resumo);
    }

    let novos = 0;
    for (const evento of eventos) {
      if (await notificacoes.registrar(evento)) novos += 1;
    }

    if (novos > 0) await notificacoes.podar();
    return novos;
  } catch {
    return 0; // notificação nunca pode quebrar o Início.
  }
}
