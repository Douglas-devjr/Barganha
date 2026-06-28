/**
 * C4.3 — Serviço de conta anônima.
 *
 * Cria uma conta sem nenhum dado pessoal (docs/04) e devolve o `usuarioId`, que
 * o app guarda e reapresenta como `Authorization: Bearer <id>`. É o mínimo para
 * que a ingestão (lado privado) tenha um dono — consulta e sync seguem anônimos.
 */

import type { ContaAnonimaResponse } from '@barganha/shared';

import type { RepositorioUsuario } from './tipos';

export class ServicoConta {
  constructor(private readonly repo: RepositorioUsuario) {}

  async criarAnonima(): Promise<ContaAnonimaResponse> {
    const usuarioId = await this.repo.criarAnonimo();
    return { usuarioId };
  }
}
