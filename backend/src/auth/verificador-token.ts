/**
 * C4.3.1 — Verificação de token de autenticação (login real, Supabase Auth).
 *
 * Porta única onde o backend troca um access token (JWT do Supabase) pelo id do
 * usuário (`auth.users.id`). Substitui o "UUID-como-Bearer" da conta anônima —
 * exatamente o ponto que docs/01 antecipa: "evoluir para JWT/Supabase Auth é
 * trocar só esta peça".
 *
 * LGPD (docs/04): o token identifica o usuário SÓ do lado PRIVADO (ingestão do
 * histórico). O pool compartilhado (`observacao_preco`) segue anônimo — nada
 * aqui o toca, e o `sub` do token nunca cruza para uma observação de preço.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { log } from '../observabilidade/log';
import { type Metricas, metricasNulas } from '../observabilidade/metricas';
import { sanitizarErro } from '../observabilidade/sanitizar';

export interface VerificadorToken {
  /**
   * Valida o access token e devolve o id do usuário (`auth.users.id`), ou
   * `undefined` se for inválido/expirado. Nunca lança por token ruim — credencial
   * inválida é um caminho esperado (a camada HTTP responde 401).
   */
  verificar(token: string): Promise<string | undefined>;
}

/**
 * Valida o JWT contra o GoTrue do Supabase (`auth.getUser`). Robusto a qualquer
 * algoritmo de assinatura (HS256 legado ou chaves assimétricas novas) e ciente
 * de revogação — ao custo de uma chamada à Auth API por request privado. Aceitável:
 * a ingestão é assíncrona (202 + fila) e de baixa frequência (um scan por compra).
 */
export class VerificadorTokenSupabase implements VerificadorToken {
  constructor(private readonly db: SupabaseClient) {}

  async verificar(token: string): Promise<string | undefined> {
    try {
      const { data, error } = await this.db.auth.getUser(token);
      // Token inválido/expirado é caminho ESPERADO (o app com sessão vencida cai
      // aqui o tempo todo): `debug`, nunca `warn` — senão a linha vira ruído.
      if (error || !data.user) {
        log.debug({ action: 'auth.token_recusado' }, 'Token recusado pelo GoTrue');
        return undefined;
      }
      return data.user.id;
    } catch (erro) {
      // ACHADO (b): responder 401 aqui está certo, mas ficar CALADO não. Uma
      // indisponibilidade do Supabase Auth era indistinguível de token inválido
      // — a operação via "ninguém consegue entrar" sem nenhuma pista. `error`:
      // não há recuperação automática e todo login está caindo.
      log.error(
        { action: 'auth.indisponivel', erro: sanitizarErro(erro) },
        'Falha ao verificar token no GoTrue — tratando como não autenticado',
      );
      return undefined;
    }
  }
}

/** Nome do cache nas métricas — chave estável de painel e de alerta. */
const NOME_CACHE = 'token-auth';

/** Janela máxima que um token verificado fica em cache. */
const TTL_CACHE_MS = 60_000;
/** Teto de entradas — o cache é uma otimização, não pode virar vazamento. */
const MAX_ENTRADAS_CACHE = 10_000;

interface EntradaCache {
  usuarioId: string;
  expiraEm: number;
}

/**
 * Memoriza verificações BEM-SUCEDIDAS por uma janela curta.
 *
 * Sem isto, todo request privado gastava uma ida de rede ao GoTrue — latência
 * somada à ingestão e consumo do rate limit da Auth API do Supabase. Com o
 * polling do app (a tela da nota consulta o cupom em laço enquanto o parsing
 * roda), o mesmo token era revalidado dezenas de vezes por minuto.
 *
 * Duas decisões deliberadas:
 *  • Só sucesso entra no cache. Token inválido continua batendo no GoTrue —
 *    cachear negativa transformaria uma indisponibilidade momentânea da Auth
 *    API em 401 grudado para um usuário legítimo.
 *  • A janela é curta e limitada também pelo `exp` do próprio token, então a
 *    revogação (logout, conta apagada) demora no MÁXIMO `TTL_CACHE_MS` para
 *    valer. É o preço explícito da otimização: o caminho de apagar conta
 *    continua indo ao banco, não ao cache.
 *
 * A chave é o token inteiro e o cache vive no processo — nada aqui persiste.
 */
export class VerificadorTokenCache implements VerificadorToken {
  private readonly cache = new Map<string, EntradaCache>();

  constructor(
    private readonly interno: VerificadorToken,
    private readonly ttlMs: number = TTL_CACHE_MS,
    private readonly agora: () => number = Date.now,
    /**
     * C10.4 — hit/miss. Sem esta medida não havia como saber se o cache estava
     * cumprindo o que promete: a taxa de acerto é a diferença entre economizar
     * uma ida ao GoTrue por request e gastar memória para nada. Uma taxa que
     * despenca também denuncia app com token novo a cada chamada.
     */
    private readonly metricas: Metricas = metricasNulas,
  ) {}

  async verificar(token: string): Promise<string | undefined> {
    const t = this.agora();
    const emCache = this.cache.get(token);
    if (emCache && emCache.expiraEm > t) {
      this.metricas.observarCache(NOME_CACHE, 'hit');
      return emCache.usuarioId;
    }
    this.metricas.observarCache(NOME_CACHE, 'miss');
    // Expirou: fora do mapa antes de revalidar (se falhar, não fica lixo).
    if (emCache) this.cache.delete(token);

    const usuarioId = await this.interno.verificar(token);
    if (!usuarioId) return undefined;

    // Nunca sobreviver ao próprio token: um JWT prestes a expirar não pode
    // ficar valendo mais 60s por estar em cache.
    const restante = expiracaoEmMs(token, t);
    const validade = Math.min(this.ttlMs, restante ?? this.ttlMs);
    if (validade > 0) {
      this.podarSeNecessario(t);
      this.cache.set(token, { usuarioId, expiraEm: t + validade });
    }
    return usuarioId;
  }

  /** Descarta o que já venceu; se ainda estiver cheio, esvazia (é só cache). */
  private podarSeNecessario(t: number): void {
    if (this.cache.size < MAX_ENTRADAS_CACHE) return;
    for (const [chave, entrada] of this.cache) {
      if (entrada.expiraEm <= t) this.cache.delete(chave);
    }
    if (this.cache.size >= MAX_ENTRADAS_CACHE) this.cache.clear();
  }
}

/**
 * Lê o `exp` do JWT SEM verificar assinatura — usado só para ENCURTAR a janela
 * de cache, nunca para autorizar. A verificação de verdade já aconteceu no
 * GoTrue; um `exp` forjado só faria o token ser revalidado antes da hora.
 */
function expiracaoEmMs(token: string, agora: number): number | undefined {
  const partes = token.split('.');
  if (partes.length !== 3 || !partes[1]) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (typeof payload.exp !== 'number') return undefined;
    return payload.exp * 1000 - agora;
  } catch {
    return undefined;
  }
}
