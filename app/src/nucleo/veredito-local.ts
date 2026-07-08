/**
 * C7.2/C7.3 — Veredito na gôndola. Resolve barato/na média/caro PRIMEIRO do
 * cache local (offline) e, quando há sinal, refina com a consulta regional.
 *
 * A inteligência (classificar/montar híbrido) é de `@barganha/shared` — a MESMA
 * que o backend usaria. Aqui só juntamos os ingredientes locais:
 *   • REGIONAL : melhor faixa do `cache_estatistica` para o produto (delta sync);
 *   • PESSOAL  : faixa já calculada do catálogo (suas compras).
 * E normalizamos o preço de prateleira digitado com o mesmo mapa de unidades.
 */

import {
  type ConsultaPrecoResponse,
  ESCOPO_GEO,
  type EscopoGeo,
  type FaixaPreco,
  montarVeredito,
  normalizarPreco,
  type UnidadeBase,
  unidadePadraoDaBase,
  type VeredictoHibrido,
} from '@barganha/shared';

import { clienteApi, ErroApi } from '@/api';
import { cache } from '@/dados';
import type { CacheEstatistica } from '@/dados';
import { resolverLocalizacao } from '@/nucleo/localizacao';

export interface ResultadoVeredito {
  hibrido: VeredictoHibrido;
  /** Escopo geográfico do ângulo regional usado (loja→município→região→UF). */
  escopoRegional?: EscopoGeo;
  /** `true` quando nenhum ângulo (regional/pessoal) tinha dado. */
  semDados: boolean;
}

export interface EntradaVeredito {
  /** Valor digitado na prateleira (R$ na unidade de venda). */
  precoPrateleira: number;
  produtoCanonicoId?: string | null;
  /** Faixa pessoal já pronta (do catálogo), se houver histórico. */
  faixaPessoal?: FaixaPreco;
  /**
   * Unidade de venda do preço digitado. Quando omitida, assume-se a venda na
   * própria unidade-base do produto (fator 1) — o caso comum de pacote por UN,
   * carne por KG, etc.
   */
  unidadeVenda?: string;
}

const ESPECIFICIDADE: Record<EscopoGeo, number> = ESCOPO_GEO.reduce(
  (acc, escopo, i) => ({ ...acc, [escopo]: i }),
  {} as Record<EscopoGeo, number>,
);

/**
 * Mínimo de observações p/ um nível ser considerado confiável offline. Espelha o
 * `MIN_OBSERVACOES_FALLBACK` do backend (docs/06, a calibrar com dados reais).
 */
const MIN_OBSERVACOES_REGIONAL = 3;

/**
 * Escolhe a melhor linha de cache para o produto — o análogo OFFLINE do
 * `resolverFallback` do backend (C3.3): o nível MAIS ESPECÍFICO
 * (loja→município→região→UF) que atinge o mínimo de observações; se nenhum
 * atinge, o de MAIOR base. Preferir o mais específico é o que faz o município
 * (o nível principal) ganhar da UF, que sempre tem mais observações por agregá-lo.
 */
function melhorEstatistica(linhas: readonly CacheEstatistica[]): CacheEstatistica | undefined {
  if (linhas.length === 0) return undefined;

  // Uma linha por escopo: a de maior base (mesmo EAN pode vir em unidades diferentes).
  const porEscopo = new Map<EscopoGeo, CacheEstatistica>();
  for (const l of linhas) {
    const atual = porEscopo.get(l.escopo);
    if (!atual || l.nObservacoes > atual.nObservacoes) porEscopo.set(l.escopo, l);
  }
  const candidatos = [...porEscopo.values()].sort(
    (a, b) => ESPECIFICIDADE[a.escopo] - ESPECIFICIDADE[b.escopo],
  );

  // 1) Mais específico com base suficiente.
  for (const l of candidatos) {
    if (l.nObservacoes >= MIN_OBSERVACOES_REGIONAL) return l;
  }
  // 2) Ninguém atinge o mínimo → o de maior base disponível.
  let melhor: CacheEstatistica | undefined;
  for (const l of porEscopo.values()) {
    if (!melhor || l.nObservacoes > melhor.nObservacoes) melhor = l;
  }
  return melhor;
}

function comoFaixa(e: CacheEstatistica): FaixaPreco {
  return {
    ...(e.mediana != null ? { mediana: e.mediana } : {}),
    ...(e.p25 != null ? { p25: e.p25 } : {}),
    ...(e.p75 != null ? { p75: e.p75 } : {}),
    ...(e.menorPromocional != null ? { menorPromocional: e.menorPromocional } : {}),
    nObservacoes: e.nObservacoes,
    unidadeBase: e.unidadeBase,
    atualizadoEm: e.atualizadoEm,
  };
}

/** Normaliza o preço digitado para a unidade-base do produto. */
function normalizarPrateleira(
  preco: number,
  unidadeBase: UnidadeBase | undefined,
  unidadeVenda: string | undefined,
): number | null {
  const unidade = unidadeVenda ?? (unidadeBase ? unidadePadraoDaBase(unidadeBase) : 'UN');
  const norm = normalizarPreco({ unidade, valorUnitario: preco });
  return norm?.precoNormalizado ?? null;
}

/** Resolve o veredito do cache local (offline-first). */
export async function resolverVeredito(entrada: EntradaVeredito): Promise<ResultadoVeredito> {
  let regional: FaixaPreco | undefined;
  let escopoRegional: EscopoGeo | undefined;

  if (entrada.produtoCanonicoId) {
    const linhas = await cache.listarEstatisticasDoProduto(entrada.produtoCanonicoId);
    const melhor = melhorEstatistica(linhas);
    if (melhor) {
      regional = comoFaixa(melhor);
      escopoRegional = melhor.escopo;
    }
  }

  const unidadeBase = regional?.unidadeBase ?? entrada.faixaPessoal?.unidadeBase;
  const precoNormalizado = normalizarPrateleira(
    entrada.precoPrateleira,
    unidadeBase,
    entrada.unidadeVenda,
  );

  const hibrido = montarVeredito({
    precoPrateleira: precoNormalizado ?? entrada.precoPrateleira,
    ...(regional ? { regional } : {}),
    ...(entrada.faixaPessoal ? { pessoal: entrada.faixaPessoal } : {}),
  });

  return {
    hibrido,
    ...(escopoRegional ? { escopoRegional } : {}),
    semDados: !regional && !entrada.faixaPessoal,
  };
}

/**
 * Refina o ângulo regional online: consulta o pool por EAN/nome no recorte da
 * região do usuário (município + UF), grava no cache (para ficar offline na
 * próxima vez) e devolve a resposta — inclusive o `produtoCanonicoId` resolvido,
 * útil quando o EAN escaneado ainda não estava no histórico local. Best-effort:
 * `null` quando offline ou sem dado.
 */
export async function refinarRegionalOnline(ref: {
  ean?: string | null;
  nome?: string | null;
}): Promise<ConsultaPrecoResponse | null> {
  const local = await resolverLocalizacao();
  try {
    const resp = await clienteApi.consultarPreco({
      ...(ref.ean ? { ean: ref.ean } : {}),
      ...(!ref.ean && ref.nome ? { nome: ref.nome } : {}),
      ...(local?.uf ? { uf: local.uf } : {}),
      ...(local?.municipio ? { municipio: local.municipio } : {}),
    });
    if (!resp) return null;
    await cache.salvarEstatisticas([resp.estatistica]);
    return resp;
  } catch (e) {
    if (e instanceof ErroApi) return null; // offline/sem dado — mantém o cache.
    throw e;
  }
}
