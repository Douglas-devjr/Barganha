/**
 * Regras PURAS do feed de notificações (testáveis sem React Native/SQLite):
 * transformam o que o app já calcula — alertas disparados e selos de
 * contribuição — em eventos prontos para persistir.
 *
 * O que faz este arquivo existir é a DEDUPLICAÇÃO. `verificarAlertas()` roda a
 * cada foco do Início, e `calcularContribuicao()` recalcula os selos do zero
 * toda vez; sem uma chave estável o feed viraria uma enxurrada do mesmo aviso.
 * Cada tipo tem o seu bucket:
 *
 *   • preço baixou  → um por produto/motivo por DIA (se cair de novo amanhã,
 *                     avisa de novo; se o app focar 20× hoje, avisa uma vez)
 *   • conquista     → um por selo, para sempre (selo não se desbloqueia 2×)
 *   • resumo do mês → um por MÊS
 */

import type { NovaNotificacao } from '@/dados/repositorio-notificacoes';

import type { AlertaDisparado } from './alertas-regras';
import type { Selo } from './gamificacao';

/** `YYYY-MM-DD` no fuso LOCAL (o mesmo critério de dia usado na gamificação). */
export function diaLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** `YYYY-MM` no fuso local. */
export function mesLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function moeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Alerta disparado → evento do feed. Um por produto/motivo/dia: o disparo é
 * recalculado a cada foco, mas o usuário só precisa saber uma vez por dia.
 */
export function deAlerta(d: AlertaDisparado, agora = new Date()): NovaNotificacao {
  const referencia = d.motivo === 'tipico' ? d.mediana : d.menorVisto;
  const comoChegou =
    d.motivo === 'tipico'
      ? `Típico na sua região: ${moeda(referencia ?? 0)}`
      : `Menor visto na região: ${moeda(referencia ?? 0)}`;

  return {
    tipo: 'preco_baixou',
    chaveDedupe: `preco:${d.produtoCanonicoId}:${d.motivo}:${diaLocal(agora)}`,
    titulo: `${d.nome} chegou ao seu alvo`,
    subtitulo: `${comoChegou} · seu alvo ${moeda(d.precoAlvo)}`,
    produtoCanonicoId: d.produtoCanonicoId,
    criadoEm: agora.toISOString(),
  };
}

/**
 * Selos conquistados → eventos do feed. Só os já conquistados viram evento, e
 * a chave é o id do selo: recalcular a contribuição não gera duplicata.
 */
export function deSelos(selos: Selo[], agora = new Date()): NovaNotificacao[] {
  return selos
    .filter((s) => s.conquistado)
    .map((s) => ({
      tipo: 'conquista' as const,
      chaveDedupe: `selo:${s.id}`,
      titulo: `Conquista desbloqueada: ${s.titulo}`,
      subtitulo: s.descricao,
      criadoEm: agora.toISOString(),
    }));
}

/**
 * Resumo do mês fechado → um evento por mês. Recebe o mês (`YYYY-MM`) e a
 * economia daquele mês, já apurados por `cupons.economiaPorMes()`.
 */
export function deResumoMensal(
  mes: string,
  economia: number,
  agora = new Date(),
): NovaNotificacao | null {
  // Sem economia registrada não há o que comemorar — não polui o feed.
  if (economia <= 0) return null;
  return {
    tipo: 'resumo_mes',
    chaveDedupe: `resumo:${mes}`,
    titulo: `Seu resumo de ${rotuloMes(mes)}`,
    subtitulo: `Você teve ${moeda(economia)} em descontos no mês.`,
    criadoEm: agora.toISOString(),
  };
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

function rotuloMes(mes: string): string {
  const [ano, m] = mes.split('-');
  const idx = Number(m) - 1;
  return MESES[idx] ? `${MESES[idx]} de ${ano}` : mes;
}
