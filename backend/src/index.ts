import { BARGANHA } from '@barganha/shared';

/**
 * Ponto de entrada do backend (placeholder da fundação — C0).
 *
 * Os parsers SEFAZ, a ingestão de QR, a camada de anonimização e a API de
 * consulta chegam a partir da Camada 2. Aqui só validamos a costura do
 * monorepo: o backend importa de `@barganha/shared`.
 */
export function main(): void {
  console.log(`${BARGANHA.nome} backend — fundação pronta (contrato v${BARGANHA.versaoContrato}).`);
}
