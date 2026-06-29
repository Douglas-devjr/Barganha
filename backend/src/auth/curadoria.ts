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
 */

import { extrairUsuarioId } from './autenticador';

interface HeadersRequest {
  authorization?: string;
  'x-usuario-id'?: string | string[];
}

/** Contrato que a camada HTTP consome para autorizar uma ação de curadoria. */
export interface AutorizacaoCuradoria {
  autorizado(headers: HeadersRequest): boolean;
}

export class GuardaCuradoria implements AutorizacaoCuradoria {
  private readonly tokens: ReadonlySet<string>;

  constructor(tokens: Iterable<string>) {
    this.tokens = new Set([...tokens].map((t) => t.trim()).filter((t) => t.length > 0));
  }

  autorizado(headers: HeadersRequest): boolean {
    // Sem token configurado → nega tudo (fail-closed): nunca expõe curadoria por
    // omissão de configuração.
    if (this.tokens.size === 0) return false;
    const token = extrairUsuarioId(headers); // reaproveita o parser de Bearer
    return token != null && this.tokens.has(token);
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
