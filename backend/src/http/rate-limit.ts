/**
 * C9.3.2 — Limitador de taxa (anti-abuso), em memória e SEM dependência nova.
 *
 * Fecha dois buracos abertos de propósito no MVP (docs/11, C9.3.2):
 *  • `POST /conta/anonima` sem limite → criação ilimitada de contas.
 *  • Consulta/sync (públicas) sem limite → scraping do pool compartilhado.
 *
 * Estratégia: janela fixa por chave (IP ou conta). Simples e suficiente para o
 * MVP. O estado vive NO PROCESSO — numa frota com várias instâncias (C10),
 * trocar por um store compartilhado (ex.: Redis) mantendo esta interface.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

export interface OpcoesLimite {
  /** Tamanho da janela, em milissegundos. */
  janelaMs: number;
  /** Máximo de requisições por chave dentro de uma janela. */
  maximo: number;
  /** Relógio injetável (testes determinísticos). Padrão: `Date.now`. */
  agora?: () => number;
}

interface Janela {
  inicio: number;
  contagem: number;
}

/**
 * Conta requisições por chave numa janela fixa e zera quando a janela vira.
 * Poda janelas expiradas no máximo uma vez por janela, para a memória não
 * crescer com chaves (IPs) que nunca mais voltam.
 */
export class LimitadorJanelaFixa {
  private readonly janelas = new Map<string, Janela>();
  private readonly agora: () => number;
  private proximaPoda: number;

  constructor(private readonly opcoes: OpcoesLimite) {
    this.agora = opcoes.agora ?? Date.now;
    this.proximaPoda = this.agora() + opcoes.janelaMs;
  }

  /** Registra um acesso da `chave`; `true` se ainda dentro do limite. */
  permitir(chave: string): boolean {
    const t = this.agora();
    if (t >= this.proximaPoda) this.podar(t);

    const janela = this.janelas.get(chave);
    if (!janela || t - janela.inicio >= this.opcoes.janelaMs) {
      this.janelas.set(chave, { inicio: t, contagem: 1 });
      return true;
    }
    janela.contagem += 1;
    return janela.contagem <= this.opcoes.maximo;
  }

  private podar(t: number): void {
    for (const [chave, janela] of this.janelas) {
      if (t - janela.inicio >= this.opcoes.janelaMs) this.janelas.delete(chave);
    }
    this.proximaPoda = t + this.opcoes.janelaMs;
  }
}

export interface OpcoesGuarda {
  /** Deriva a chave do cliente. Padrão: IP da requisição. */
  chave?: (req: FastifyRequest) => string;
  /** Texto do erro no 429. */
  mensagem?: string;
}

/**
 * Hook `onRequest` do Fastify: barra com 429 quando a chave estoura o limite.
 * Roda ANTES do handler — não consome o serviço protegido. É `async` (sempre
 * devolve promessa) para o Fastify avançar o ciclo; ao enviar o 429 o reply é
 * marcado como respondido e o handler não roda.
 */
export function guardaDeTaxa(limitador: LimitadorJanelaFixa, opcoes: OpcoesGuarda = {}) {
  const chaveDe = opcoes.chave ?? ((req: FastifyRequest) => req.ip);
  const mensagem = opcoes.mensagem ?? 'Muitas requisições. Tente novamente em instantes.';
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!limitador.permitir(chaveDe(req))) {
      await reply.code(429).send({ erro: mensagem });
    }
  };
}

/**
 * Barra por CONTA já autenticada. Devolve `true` quando passou; ao estourar,
 * responde 429 e devolve `false` (o handler deve parar).
 *
 * Existe como função, e não como hook `onRequest`, por um motivo de segurança:
 * o hook roda ANTES da autenticação, então a única chave disponível ali seria o
 * Bearer CRU, não verificado. Chavear por ele tornava o teto inútil — bastava
 * variar o header a cada requisição para ganhar uma janela nova (e ainda fazia
 * o mapa crescer com um JWT inteiro por chave). Agora a chave é o `usuarioId`
 * que o verificador devolveu: um atacante teria de possuir contas reais.
 */
export async function barrarPorConta(
  limitador: LimitadorJanelaFixa,
  usuarioId: string,
  reply: FastifyReply,
  mensagem = 'Muitas requisições. Tente novamente em instantes.',
): Promise<boolean> {
  if (limitador.permitir(`conta:${usuarioId}`)) return true;
  await reply.code(429).send({ erro: mensagem });
  return false;
}
