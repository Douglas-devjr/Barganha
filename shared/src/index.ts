/**
 * @barganha/shared — contratos e tipos compartilhados entre app e backend.
 *
 * Camada 1 (C1.3): modelo de domínio v1, contrato `NotaEstruturada`, DTOs de
 * API e a fronteira de anonimização (C1.4). Tipos de domínio em português;
 * mantidos em sincronia com supabase/migrations e docs/02-modelo-de-dados.md.
 */

export * from './core';
export * from './dominio/enums';
export * from './dominio/nota-estruturada';
export * from './dominio/entidades';
export * from './anonimizacao/gate';
export * from './api/dtos';
export * from './estatistica/veredito';
