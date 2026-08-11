/**
 * C9.3.2 — Limitador de taxa em Postgres (o teto vale para a frota inteira).
 *
 * Mesma interface que `LimitadorJanelaFixa`, mas o contador mora em
 * `rate_limit_janela` em vez de um Map do processo. É o que permite duas ou
 * mais instâncias respeitarem o MESMO teto — em memória, subir uma segunda
 * instância dobrava silenciosamente todos os limites.
 *
 * Toda a decisão acontece em UMA chamada: a função `consumir_rate_limit`
 * incrementa e responde se cabe no teto, num único `insert ... on conflict`.
 * Isso não é detalhe de performance, é correção — ver `docs/12`: a versão
 * anterior lia e depois gravava em duas idas ao banco, e requisições
 * concorrentes na mesma chave liam todas a mesma contagem. O teto vazava
 * justamente sob flood, que é quando ele precisa valer.
 *
 * Quando o banco falha, NÃO derruba a API: cai para um contador em memória
 * (ver `permitir`). O limitador é proteção, não caminho crítico do produto.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { LimitadorJanelaFixa, type Limitador, type OpcoesLimite } from './rate-limit';

/** Sobe no log quando o banco recusa; agrupa o alerta de indisponibilidade. */
const ACAO_LOG = '[rate-limit]';

/**
 * Implementação Postgres do limitador de taxa.
 *
 * `escopo` separa os tetos que compartilham a tabela: os quatro guardas do
 * servidor chaveiam por IP, e sem o escopo o mesmo IP consumiria UMA linha só
 * para quatro limites diferentes (o mais apertado barrava os outros três, e o
 * mais folgado levantava o teto de todos).
 */
export class LimitadorJanelaFixaPostgres implements Limitador {
  private proximaPoda: number;
  private readonly agora: () => number;
  /** Contador local usado só enquanto o banco estiver fora (degrada, não abre). */
  private readonly reserva: LimitadorJanelaFixa;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly escopo: string,
    private readonly opcoes: OpcoesLimite,
  ) {
    this.agora = opcoes.agora ?? Date.now;
    this.proximaPoda = this.agora() + opcoes.janelaMs;
    this.reserva = new LimitadorJanelaFixa(escopo, opcoes);
  }

  /**
   * Registra um acesso da `chave`. Devolve `true` se ainda cabe no teto.
   *
   * Com o banco fora, responde pelo contador em memória em vez de estourar: um
   * erro aqui subiria como 500 em TODAS as rotas (o limitador roda no
   * `onRequest`, antes de qualquer handler), ou seja, uma instabilidade do
   * Postgres derrubaria consulta e sync junto. O teto continua existindo,
   * só volta a valer por processo enquanto durar a falha.
   */
  async permitir(chave: string): Promise<boolean> {
    const t = this.agora();
    if (t >= this.proximaPoda) await this.podar(t);

    const { data, error } = await this.supabase.rpc('consumir_rate_limit', {
      p_chave: `${this.escopo}:${chave}`,
      p_agora: t,
      p_janela_ms: this.opcoes.janelaMs,
      p_maximo: this.opcoes.maximo,
    });

    if (error) {
      console.error(`${ACAO_LOG} banco indisponível, caindo para memória:`, error.message);
      return this.reserva.permitir(chave);
    }

    return data === true;
  }

  /**
   * Remove as janelas já encerradas. Roda no máximo uma vez por janela — a
   * varredura custa mais que o próprio check, e a tabela sem poda cresceria
   * com um IP que apareceu uma vez e nunca mais voltou.
   */
  private async podar(t: number): Promise<void> {
    // Marca ANTES de chamar: se a poda falhar, a próxima tentativa fica para a
    // janela seguinte em vez de repetir a cada requisição com o banco ruim.
    this.proximaPoda = t + this.opcoes.janelaMs;

    const { error } = await this.supabase.rpc('podar_rate_limit', { p_agora: t });
    // Log e segue: a poda é higiene, não pode derrubar quem está passando.
    if (error) console.error(`${ACAO_LOG} erro ao podar janelas:`, error.message);
  }
}
