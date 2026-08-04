/**
 * Normalização de preço/descrição — FONTE ÚNICA em `@barganha/shared`.
 *
 * Antes vivia aqui; foi promovida a `shared/estatistica/normalizacao` (C7) para
 * o app classificar o preço de prateleira offline com o MESMO mapa de unidades
 * do backend — sem divergência. Este módulo só re-exporta, preservando os
 * imports existentes (`./normalizacao`) da camada de anonimização (C2.4).
 */

export {
  type PrecoNormalizado,
  MAPA_UNIDADES,
  normalizarPreco,
  normalizarDescricao,
  chaveUnidade,
  unidadeConhecida,
} from '@barganha/shared';
