/**
 * Autorização de CURADORIA (C11) — endpoints privilegiados de operação:
 *   • moderar lançamentos manuais de gôndola (C11.3);
 *   • enriquecer produtos canônicos (nome/categoria/foto, C11.5).
 *
 * Estes endpoints NÃO são abertos como a leitura pública do pool, nem ligados a
 * uma conta de usuário comum (cuja credencial é o próprio `usuarioId`, C4.3.1) —
 * dar a um usuário qualquer o poder de aprovar preços ou reescrever o catálogo
 * abriria abuso. A v1 usa um conjunto de tokens estáticos vindos do ambiente
 * (`CURADORIA_TOKENS`), no mesmo espírito "auth mínima" de C4.3: evoluir para
 * papéis/Supabase Auth é trocar só esta peça.
 *
 * Falha fechada: sem nenhum token configurado, NADA é autorizado.
 *
 * A comparação é em tempo constante (ver `iguala`): um `Set.has` sai no primeiro
 * caractere divergente, e a diferença de tempo entre "errou no 1º" e "errou no
 * 20º" é medível o bastante para reconstruir o token byte a byte.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { extrairUsuarioId } from './autenticador';

/**
 * Compara em tempo constante. Passa pelo SHA-256 antes porque
 * `timingSafeEqual` exige buffers do MESMO tamanho — e o próprio comprimento do
 * token não pode virar canal lateral. O digest tem 32 bytes sempre.
 */
function iguala(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

interface HeadersRequest {
  authorization?: string;
  'x-usuario-id'?: string | string[];
}

/** Contrato que a camada HTTP consome para autorizar uma ação de curadoria. */
export interface AutorizacaoCuradoria {
  autorizado(headers: HeadersRequest): boolean;
}

export class GuardaCuradoria implements AutorizacaoCuradoria {
  private readonly tokens: readonly string[];

  constructor(tokens: Iterable<string>) {
    // Lista, não Set: a varredura precisa ser COMPLETA (sem curto-circuito no
    // primeiro acerto) para o tempo não denunciar qual token casou.
    this.tokens = [...new Set([...tokens].map((t) => t.trim()).filter((t) => t.length > 0))];
  }

  autorizado(headers: HeadersRequest): boolean {
    // Sem token configurado → nega tudo (fail-closed): nunca expõe curadoria por
    // omissão de configuração.
    if (this.tokens.length === 0) return false;
    const token = extrairUsuarioId(headers); // reaproveita o parser de Bearer
    if (token == null) return false;
    let ok = false;
    for (const valido of this.tokens) {
      // Sem `break`/`||=` de curto-circuito: acumula o resultado percorrendo
      // todos os tokens, sempre no mesmo custo.
      if (iguala(token, valido)) ok = true;
    }
    return ok;
  }
}

/** Parse de `CURADORIA_TOKENS` ("tok1,tok2") → lista de tokens (sem vazios). */
export function parseCuradoriaTokens(bruto: string | undefined): string[] {
  if (!bruto) return [];
  return bruto
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
