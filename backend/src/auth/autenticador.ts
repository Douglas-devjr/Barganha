/**
 * C4.3 — Autenticação mínima.
 *
 * Resolve o usuário de um request e valida que a conta REALMENTE existe (gate de
 * acesso). É deliberadamente simples: o `usuarioId` é um token opaco (UUID), sem
 * senha nem perfil — coerente com a conta anônima e a minimização da LGPD
 * (docs/04). Evoluir para JWT/Supabase Auth é trocar só esta peça.
 *
 * Aceita o id em `Authorization: Bearer <id>` (forma nova) ou no header legado
 * `x-usuario-id` (compat com a ingestão de C2). Sem id válido → `undefined`, e a
 * camada HTTP responde 401.
 *
 * Só os endpoints PRIVADOS (ingestão) passam por aqui. Consulta e delta sync
 * lêem apenas o pool compartilhado anônimo e não exigem conta (docs/01, docs/04).
 */

import type { RepositorioUsuario } from './tipos';

export interface HeadersRequest {
  authorization?: string;
  'x-usuario-id'?: string | string[];
}

/** Extrai o id candidato dos headers (Bearer preferido; header legado depois). */
export function extrairUsuarioId(headers: HeadersRequest): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) return m[1].trim();
  }
  const legado = headers['x-usuario-id'];
  if (typeof legado === 'string' && legado.length > 0) return legado;
  return undefined;
}

/** Contrato que a camada HTTP consome para autenticar um request. */
export interface Autenticacao {
  resolver(headers: HeadersRequest): Promise<string | undefined>;
}

export class Autenticador implements Autenticacao {
  constructor(private readonly repo: RepositorioUsuario) {}

  async resolver(headers: HeadersRequest): Promise<string | undefined> {
    const id = extrairUsuarioId(headers);
    if (!id) return undefined;
    return (await this.repo.existe(id)) ? id : undefined;
  }
}
