/**
 * C3.3 — Escopos geográficos + fallback hierárquico.
 *
 * Duas responsabilidades puras (sem I/O):
 *  1. DERIVAR de uma observação as chaves de cada escopo onde ela conta — a
 *     mesma observação alimenta a estatística da loja, do município e da UF
 *     (agregação aninhada). É assim que o pipeline gera uma linha por nível.
 *  2. RESOLVER, na consulta, o nível MAIS ESPECÍFICO com base suficiente,
 *     subindo loja → município → região → UF até atingir o `n` mínimo (docs/06).
 *     Sempre há resposta; quando nenhum nível atinge o mínimo, devolve o de
 *     maior base disponível com `baixaConfianca = true`.
 *
 * Região (`regiao`) fica entre município e UF (ex.: região metropolitana). Sem
 * dados de referência de metrorregião na v1, é resolvida por um `ResolvedorRegiao`
 * injetável que por padrão devolve `undefined` — o nível é simplesmente pulado
 * no fallback até a base de dados existir (a calibrar; docs/06).
 */

import {
  chaveMunicipio as chaveMunicipioCanonica,
  ESCOPO_GEO,
  type EscopoGeo,
  MIN_OBSERVACOES_CONFIAVEL,
  type PrecoEstatistica,
} from '@barganha/shared';

/**
 * Mínimo de observações p/ um nível ser considerado confiável. A fonte é
 * `shared` — o app decide igual, offline. Alias mantido pelo nome já usado aqui.
 */
export const MIN_OBSERVACOES_FALLBACK = MIN_OBSERVACOES_CONFIAVEL;

/** Ordem do fallback: do mais específico ao mais amplo. */
export const ORDEM_FALLBACK: readonly EscopoGeo[] = ESCOPO_GEO;

/** Local de uma observação/consulta (geo derivada da LOJA, nunca do usuário). */
export interface LocalGeo {
  lojaCnpj: string;
  municipio?: string;
  uf?: string;
}

/** Resolve a chave de `regiao` p/ um local; `undefined` = sem dado (v1). */
export type ResolvedorRegiao = (local: LocalGeo) => string | undefined;

const semRegiao: ResolvedorRegiao = () => undefined;

/**
 * Chave estável de município: `UF:MUNICIPIO` normalizado (nome não é único entre
 * UFs). Usa a `chaveMunicipio` canônica do shared — a MESMA da escrita e da
 * leitura — para o `escopo_id` gravado e as chaves derivadas na consulta baterem
 * mesmo com caixa/acento divergentes (parser `"SAO PAULO"` vs. seletor `"São Paulo"`).
 */
function chaveMunicipio(local: LocalGeo): string | undefined {
  if (!local.uf || !local.municipio) return undefined;
  return chaveMunicipioCanonica(local.uf, local.municipio) || undefined;
}

/** Chave de um escopo p/ um local; `undefined` quando o nível não se aplica. */
export function chaveEscopo(
  escopo: EscopoGeo,
  local: LocalGeo,
  resolverRegiao: ResolvedorRegiao = semRegiao,
): string | undefined {
  switch (escopo) {
    case 'loja':
      return local.lojaCnpj || undefined;
    case 'municipio':
      return chaveMunicipio(local);
    case 'regiao':
      return resolverRegiao(local);
    case 'uf':
      return local.uf || undefined;
  }
}

export interface EscopoDerivado {
  escopo: EscopoGeo;
  escopoId: string;
}

/** Todos os escopos onde a observação conta (os que têm chave resolvível). */
export function derivarEscopos(
  local: LocalGeo,
  resolverRegiao: ResolvedorRegiao = semRegiao,
): EscopoDerivado[] {
  const derivados: EscopoDerivado[] = [];
  for (const escopo of ORDEM_FALLBACK) {
    const escopoId = chaveEscopo(escopo, local, resolverRegiao);
    if (escopoId) derivados.push({ escopo, escopoId });
  }
  return derivados;
}

export interface ResultadoFallback {
  escopoResolvido: EscopoGeo;
  estatistica: PrecoEstatistica;
  /** `true` quando nenhum nível atingiu o mínimo e usamos o de maior base. */
  baixaConfianca: boolean;
}

/**
 * Escolhe a estatística a servir entre os candidatos de um produto, honrando o
 * contexto geo do usuário. Caminha do mais específico ao mais amplo e retorna o
 * primeiro nível com `n >= minObservacoes`. Se nenhum atingir, devolve o de
 * maior `n` (mais base) com `baixaConfianca`. `undefined` só quando não há
 * candidato algum.
 *
 * `candidatos` deve conter apenas linhas cujo (escopo, escopoId) bate com o
 * `local` — o repositório pré-filtra; aqui escolhemos o nível.
 */
export function resolverFallback(
  candidatos: readonly PrecoEstatistica[],
  local: LocalGeo,
  resolverRegiao: ResolvedorRegiao = semRegiao,
  minObservacoes: number = MIN_OBSERVACOES_FALLBACK,
): ResultadoFallback | undefined {
  if (candidatos.length === 0) return undefined;

  // Indexa por escopo a linha que casa com a chave do local. Pode haver mais de
  // uma por (escopo, escopoId) quando o produto tem observações em unidades-base
  // diferentes (mesmo EAN vendido por KG e por UN); fica com a de MAIOR base (n).
  const porEscopo = new Map<EscopoGeo, PrecoEstatistica>();
  for (const escopo of ORDEM_FALLBACK) {
    const chave = chaveEscopo(escopo, local, resolverRegiao);
    if (!chave) continue;
    let linha: PrecoEstatistica | undefined;
    for (const c of candidatos) {
      if (c.escopo !== escopo || c.escopoId !== chave) continue;
      if (!linha || c.nObservacoes > linha.nObservacoes) linha = c;
    }
    if (linha) porEscopo.set(escopo, linha);
  }

  // 1) Mais específico que atinge o mínimo.
  for (const escopo of ORDEM_FALLBACK) {
    const linha = porEscopo.get(escopo);
    if (linha && linha.nObservacoes >= minObservacoes) {
      return { escopoResolvido: escopo, estatistica: linha, baixaConfianca: false };
    }
  }

  // 2) Ninguém atingiu o mínimo → o de maior base disponível, com ressalva.
  let melhor: { escopo: EscopoGeo; linha: PrecoEstatistica } | undefined;
  for (const [escopo, linha] of porEscopo) {
    if (!melhor || linha.nObservacoes > melhor.linha.nObservacoes) melhor = { escopo, linha };
  }
  if (!melhor) return undefined;
  return { escopoResolvido: melhor.escopo, estatistica: melhor.linha, baixaConfianca: true };
}
