/**
 * C4.3.1 — Autenticação com login real (Supabase Auth).
 *
 * Implementa o mesmo contrato `Autenticacao` da auth mínima (C4.3), mas valida o
 * Bearer como um JWT do Supabase via `VerificadorToken`, em vez do UUID opaco da
 * conta anônima. É a "peça trocável" de docs/01: a camada HTTP não muda — só
 * passa a confiar num token assinado.
 *
 * Só os endpoints PRIVADOS (ingestão, exclusão de conta) passam por aqui.
 * Consulta e delta sync seguem anônimos (lêem só o pool compartilhado, docs/04).
 */

import { extrairUsuarioId, type Autenticacao, type HeadersRequest } from './autenticador';
import type { VerificadorToken } from './verificador-token';

export class AutenticadorSupabase implements Autenticacao {
  constructor(private readonly verificador: VerificadorToken) {}

  async resolver(headers: HeadersRequest): Promise<string | undefined> {
    // Reaproveita a extração do Bearer (preferida). Um valor no header legado
    // `x-usuario-id` que não seja um JWT válido simplesmente falha na verificação.
    const token = extrairUsuarioId(headers);
    if (!token) return undefined;
    return this.verificador.verificar(token);
  }
}
