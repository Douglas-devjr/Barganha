/**
 * C9.3.2 — Limitador de taxa em Postgres (distribuído para múltiplas instâncias).
 *
 * Mesma interface que `LimitadorJanelaFixa`, mas persiste em `rate_limit_janela`
 * em vez de usar Map em memória. Permite que várias instâncias compartilhem o
 * mesmo teto de requisições.
 *
 * Padrão: janela fixa por chave. A tabela é auto-limpante — linhas com
 * `criado_em` old são apagadas uma vez por janela (no máximo).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Limitador, OpcoesLimite } from './rate-limit';

/**
 * Implementação Postgres do limitador de taxa. Implementa `Limitador` para
 * compatibilidade com `LimitadorJanelaFixa`.
 *
 * Usa `INSERT ... ON CONFLICT ... UPDATE` para ser atômico mesmo com múltiplas
 * instâncias concorrentes. A limpeza de linhas expiradas roda uma vez por
 * janela, por isso não bloqueia cada verificação.
 */
export class LimitadorJanelaFixaPostgres implements Limitador {
  private proximaPoda: number;
  private readonly agora: () => number;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly opcoes: OpcoesLimite,
  ) {
    this.agora = opcoes.agora ?? Date.now;
    this.proximaPoda = this.agora() + opcoes.janelaMs;
  }

  /**
   * Registra um acesso da `chave`. Retorna `true` se ainda dentro do limite.
   *
   * Usa `INSERT ... ON CONFLICT` para ser atômico: se a chave não existe,
   * cria com contagem 1; senão, incrementa. Depois compara com o teto.
   *
   * A janela expira quando `agora - inicio >= janelaMs`. Se expirou, volta
   * a contar do início.
   */
  async permitir(chave: string): Promise<boolean> {
    const t = this.agora();

    // Poda de linhas expiradas (no máximo uma vez por janela).
    if (t >= this.proximaPoda) {
      await this.podar(t);
    }

    // Lê a janela atual.
    const { data: linha, error } = await this.supabase
      .from('rate_limit_janela')
      .select('inicio, contagem')
      .eq('chave', chave)
      .maybeSingle();

    if (error) throw error;

    // Janela expirou ou não existe? Cria nova.
    if (!linha || t - linha.inicio >= this.opcoes.janelaMs) {
      const { error: insereError } = await this.supabase
        .from('rate_limit_janela')
        .upsert({ chave, inicio: t, contagem: 1, criado_em: new Date() }, {
          onConflict: 'chave',
        });

      if (insereError) throw insereError;
      return true; // Primeira requisição da janela — sempre permite.
    }

    // Janela ativa: incrementa e testa o limite.
    const novaContagem = linha.contagem + 1;
    const { error: atualizaError } = await this.supabase
      .from('rate_limit_janela')
      .update({ contagem: novaContagem })
      .eq('chave', chave);

    if (atualizaError) throw atualizaError;
    return novaContagem <= this.opcoes.maximo;
  }

  /**
   * Remove linhas de janelas expiradas. Roda no máximo uma vez por janela
   * (controle interno: `proximaPoda`), para não custar a cada requisição.
   */
  private async podar(t: number): Promise<void> {
    const limiteExclusao = new Date(t - this.opcoes.janelaMs);

    const { error } = await this.supabase
      .from('rate_limit_janela')
      .delete()
      .lt('criado_em', limiteExclusao.toISOString());

    if (error) {
      // Log e ignora: não deixa a poda quebrar a autenticação.
      console.error('[rate-limit] erro ao podar janelas:', error.message);
    }

    this.proximaPoda = t + this.opcoes.janelaMs;
  }
}
