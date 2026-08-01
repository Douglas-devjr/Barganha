/**
 * C8.4 — Serviço de alertas de preço + dispositivos de push.
 *
 * Fino de propósito: valida a forma dos itens e delega a persistência ao
 * repositório. A decisão de DISPARAR não mora aqui — vive no job
 * (`jobs/alerta-preco.ts`), que é quem lê `preco_estatistica`; este serviço só
 * mantém o espelho no servidor do alerta local (docs/04, dado PRIVADO).
 */

import type { AlertaPrecoItem, SincronizarAlertasResponse } from '@barganha/shared';

import { LancamentoInvalidoError } from '../erros';

import type { RepositorioAlertas } from './tipos-alertas';

/** Teto de alertas simultâneos por usuário — anti-abuso da fila de push. */
const MAX_ALERTAS_POR_USUARIO = 200;

/**
 * Remove duplicatas de `produtoCanonicoId`, mantendo a ÚLTIMA ocorrência (o
 * envio mais recente do mesmo produto no MESMO payload venceria de qualquer
 * forma se fossem duas chamadas sequenciais). Sem isto, um payload com o mesmo
 * produto duas vezes faria o upsert tentar atualizar a MESMA linha duas vezes
 * na mesma transação — Postgres rejeita isso (`ON CONFLICT DO UPDATE command
 * cannot affect row a second time`), e um bug de cliente viraria 500 em vez de
 * uma sincronização tolerante.
 */
function deduplicarPorProduto(itens: readonly AlertaPrecoItem[]): AlertaPrecoItem[] {
  const porProduto = new Map<string, AlertaPrecoItem>();
  for (const item of itens) porProduto.set(item.produtoCanonicoId, item);
  return [...porProduto.values()];
}

export class ServicoAlertas {
  constructor(private readonly repo: RepositorioAlertas) {}

  /** Substitui TODO o conjunto de alertas do usuário (sem drift). */
  async sincronizar(
    usuarioId: string,
    itens: readonly AlertaPrecoItem[],
  ): Promise<SincronizarAlertasResponse> {
    if (itens.length > MAX_ALERTAS_POR_USUARIO) {
      throw new LancamentoInvalidoError(
        `Máximo de ${MAX_ALERTAS_POR_USUARIO} alertas por usuário.`,
      );
    }
    for (const item of itens) {
      if (!(item.precoAlvo > 0)) {
        throw new LancamentoInvalidoError('precoAlvo deve ser um número positivo.');
      }
    }

    const dedup = deduplicarPorProduto(itens);
    await this.repo.sincronizarAlertas(usuarioId, dedup);
    return { total: dedup.length };
  }

  /** Remove todos os alertas do usuário (mantém o(s) dispositivo(s) de push). */
  async apagarTodos(usuarioId: string): Promise<void> {
    await this.repo.apagarAlertas(usuarioId);
  }

  /** Upsert do token de push do aparelho (após a pessoa aceitar a permissão). */
  async registrarDispositivo(
    usuarioId: string,
    token: string,
    plataforma: 'ios' | 'android',
  ): Promise<void> {
    if (!token.trim()) {
      throw new LancamentoInvalidoError('Token de push vazio.');
    }
    await this.repo.registrarDispositivoPush(usuarioId, token.trim(), plataforma);
  }

  /** Remove um token de push (logout, permissão revogada, reinstalação). */
  async removerDispositivo(token: string): Promise<void> {
    await this.repo.removerDispositivoPush(token);
  }
}
