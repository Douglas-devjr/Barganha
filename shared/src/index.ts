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
export * from './dominio/alertas-regras';
export * from './dominio/url-consulta';
export * from './dominio/chave-acesso';
export * from './anonimizacao/gate';
export * from './anonimizacao/exposicao';
export * from './anonimizacao/qr-payload';
export * from './api/dtos';
export * from './estatistica/veredito';
export * from './estatistica/normalizacao';
export * from './estatistica/faixa';
export * from './estatistica/frescor';
export * from './plano/direitos';
export * from './observabilidade/redacao';
export * from './observabilidade/request-id';
