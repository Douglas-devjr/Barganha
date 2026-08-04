/**
 * C13.2 — Serviço do estado do plano da conta.
 *
 * Fino de propósito: lê a linha de `assinatura` (se houver) e decide o que a
 * conta responde. Não escreve nada — ainda não existe caminho de compra
 * (C13.3) nem de contribuição (C13.4); este serviço só expõe o que já está no
 * banco. Vive fora de `servico-conta.ts` (conta anônima é legado/teste) para
 * não misturar a afordância de C4.3 com o caminho de produção do plano.
 */

import type { EstadoContaResponse } from '@barganha/shared';

import type { RepositorioAssinatura } from './tipos-assinatura';

export class ServicoAssinatura {
  constructor(private readonly repo: RepositorioAssinatura) {}

  async obterEstado(usuarioId: string): Promise<EstadoContaResponse> {
    const linha = await this.repo.obterAssinatura(usuarioId);
    if (!linha) return { plano: 'gratis' };

    // Expirado (valido_ate no passado) = trata como gratis. O backend nunca
    // confia num "plus" vencido — mesmo que o job de revogação (C13.3/C13.4)
    // ainda não tenha rodado para limpar/rebaixar a linha. Falha FECHADA: uma
    // data ilegível (NaN) também vira gratis — um campo de entitlement nunca
    // deve conceder por default diante do inesperado.
    if (linha.validoAte) {
      const validoAteMs = new Date(linha.validoAte).getTime();
      if (Number.isNaN(validoAteMs) || validoAteMs < Date.now()) {
        return { plano: 'gratis' };
      }
    }
    return { plano: linha.plano, ...(linha.validoAte ? { validoAte: linha.validoAte } : {}) };
  }
}
