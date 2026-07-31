/**
 * C7.4/C7.5 — Catálogo local. Agrupa as compras do histórico privado (SQLite)
 * em PRODUTOS e calcula, para cada um, a faixa pessoal ("seu típico"), os
 * extremos e a evolução — tudo com `@barganha/shared` (mesma matemática do
 * backend, normalização única). É a fonte das telas Produtos, Detalhe e do
 * ângulo PESSOAL do veredito (Verificar).
 *
 * Trabalha 100% offline sobre dados já no aparelho. O agrupamento roda em
 * memória: o histórico pessoal é pequeno (centenas de itens), então é barato e
 * mantém a CHAVE de produto idêntica entre lista, detalhe e veredito.
 */

import {
  type FaixaPreco,
  montarFaixaDeObservacoes,
  normalizarDescricao,
  normalizarPreco,
  type ObservacaoNormalizada,
  precoUnitarioEfetivo,
  type UnidadeBase,
} from '@barganha/shared';

import { cache, produtos } from '@/dados';
import type { CacheProduto } from '@/dados';
import type { ObservacaoLocal } from '@/dados/repositorio-produtos';

/** Produto consolidado a partir do histórico do usuário. */
export interface ProdutoLocal {
  /** Chave estável de agrupamento: id canônico → EAN → descrição normalizada. */
  chave: string;
  produtoCanonicoId: string | null;
  ean: string | null;
  /**
   * Nome exibido: o nome de catálogo baixado pela C4.5 quando existe, senão a
   * descrição mais recente vista no cupom. O curado ganha porque é escrito para
   * gente ler ("Arroz Tio João Tipo 1 5kg"), e o do cupom vem abreviado pelo PDV.
   */
  nome: string;
  /** Marca, do catálogo compartilhado (C4.5/C11.5). Ausente sem enriquecimento. */
  marca?: string;
  /** Categoria, do catálogo compartilhado (C4.5/C11.5). */
  categoria?: string;
  unidadeBase: UnidadeBase | null;
  nObservacoes: number;
  /** "Seu típico" (mediana/percentis das suas compras). */
  faixaPessoal?: FaixaPreco;
  /** Menor preço normalizado já pago (R$/base). */
  minimo?: number;
  /** Maior preço normalizado já pago (R$/base). */
  maximo?: number;
  /** Preço normalizado mais recente (R$/base) — base da tendência. */
  ultimoPreco?: number;
  /** Variação % entre a primeira e a última compra (sinal da tendência). */
  variacaoPct?: number;
}

/** Uma linha do histórico de compras de um produto (tela Detalhe). */
export interface CompraHistorico {
  lojaNome: string | null;
  observadoEm: string;
  /** Preço em R$/unidade_base; `null` quando a unidade é desconhecida. */
  precoNormalizado: number | null;
  unidade: string;
  emPromocao: boolean;
}

interface Grupo {
  produto: ProdutoLocal;
  /** Mais antiga → mais recente (pronta p/ o gráfico de evolução). */
  historico: CompraHistorico[];
}

/** Chave de agrupamento de uma observação. */
function chaveDe(o: ObservacaoLocal): string {
  if (o.produtoCanonicoId) return o.produtoCanonicoId;
  if (o.ean) return `ean:${o.ean}`;
  return `desc:${normalizarDescricao(o.descricaoOriginal)}`;
}

function emPromocao(o: ObservacaoLocal): boolean {
  return o.desconto != null && o.desconto > 0;
}

/**
 * Normaliza o preço que o usuário PAGOU: com desconto no item, o unitário
 * efetivo (líquido) — a mesma regra do pool (shared), para o "menor pago" e o
 * típico pessoal refletirem o preço real, não o cheio de um item em promoção.
 */
function normalizarPago(o: ObservacaoLocal) {
  return normalizarPreco({
    unidade: o.unidade,
    // Destrava multipack (CX/FD com contagem na descrição, C3.4) com a MESMA
    // regra do backend — se só um dos lados passasse, o mesmo item entraria no
    // pool e ficaria fora da faixa pessoal.
    descricao: o.descricaoOriginal,
    valorUnitario: precoUnitarioEfetivo({
      valorUnitario: o.valorUnitario,
      quantidade: o.quantidade,
      ...(o.desconto != null ? { desconto: o.desconto } : {}),
    }),
  });
}

/**
 * Agrupa observações soltas em produtos + histórico ordenado. `resumos` é o
 * cache de catálogo (C4.5), por id canônico; vazio = app ainda não sincronizou
 * (ou produto sem enriquecimento), e tudo segue como antes, pela descrição do
 * cupom.
 */
function agrupar(
  observacoes: readonly ObservacaoLocal[],
  resumos: ReadonlyMap<string, CacheProduto>,
): Map<string, Grupo> {
  // Pré-ordena por data crescente: o histórico já sai pronto e o "nome mais
  // recente" é o último visto.
  const ordenadas = [...observacoes].sort((a, b) => a.observadoEm.localeCompare(b.observadoEm));

  const grupos = new Map<string, { obs: ObservacaoLocal[] }>();
  for (const o of ordenadas) {
    const chave = chaveDe(o);
    const g = grupos.get(chave) ?? { obs: [] };
    g.obs.push(o);
    grupos.set(chave, g);
  }

  const resultado = new Map<string, Grupo>();
  for (const [chave, { obs }] of grupos) {
    const historico: CompraHistorico[] = obs.map((o) => {
      const norm = normalizarPago(o);
      return {
        lojaNome: o.lojaNome,
        observadoEm: o.observadoEm,
        precoNormalizado: norm?.precoNormalizado ?? null,
        unidade: o.unidade,
        emPromocao: emPromocao(o),
      };
    });

    const normalizadas: ObservacaoNormalizada[] = obs.flatMap((o) => {
      const norm = normalizarPago(o);
      if (!norm) return [];
      return [
        {
          precoNormalizado: norm.precoNormalizado,
          emPromocao: emPromocao(o),
          observadoEm: o.observadoEm,
        },
      ];
    });

    const unidadeBase = normalizadas.length > 0 ? unidadeBaseDe(obs) : null;
    const faixaPessoal =
      unidadeBase != null ? montarFaixaDeObservacoes(normalizadas, unidadeBase) : undefined;

    const precos = normalizadas.map((n) => n.precoNormalizado);
    const ultimo = ultimoNormalizado(historico);
    const primeiro = primeiroNormalizado(historico);

    const recente = obs.at(-1);
    if (!recente) continue; // grupo sempre tem ao menos 1; satisfaz o tipo
    const produtoCanonicoId = primeiroCanonico(obs);
    const resumo = produtoCanonicoId ? resumos.get(produtoCanonicoId) : undefined;
    const produto: ProdutoLocal = {
      chave,
      produtoCanonicoId,
      ean: primeiroEan(obs),
      // C4.5 — nome de catálogo quando ele existe; senão a descrição do cupom.
      // A CHAVE não muda com isso: agrupar continua sendo por id/EAN/descrição
      // normalizada, então lista, detalhe e veredito seguem falando do mesmo
      // produto mesmo que o nome mude entre uma sincronização e outra.
      nome: resumo?.nomeExibicao ?? recente.descricaoOriginal,
      ...(resumo?.marca ? { marca: resumo.marca } : {}),
      ...(resumo?.categoria ? { categoria: resumo.categoria } : {}),
      unidadeBase,
      nObservacoes: obs.length,
      ...(faixaPessoal ? { faixaPessoal } : {}),
      ...(precos.length > 0 ? { minimo: Math.min(...precos), maximo: Math.max(...precos) } : {}),
      ...(ultimo != null ? { ultimoPreco: ultimo } : {}),
      ...(primeiro != null && ultimo != null && primeiro > 0
        ? { variacaoPct: ((ultimo - primeiro) / primeiro) * 100 }
        : {}),
    };

    resultado.set(chave, { produto, historico });
  }

  return resultado;
}

function unidadeBaseDe(obs: readonly ObservacaoLocal[]): UnidadeBase | null {
  for (const o of obs) {
    const norm = normalizarPreco({
      unidade: o.unidade,
      valorUnitario: o.valorUnitario,
      descricao: o.descricaoOriginal,
    });
    if (norm) return norm.unidadeBase;
  }
  return null;
}

function primeiroCanonico(obs: readonly ObservacaoLocal[]): string | null {
  return obs.find((o) => o.produtoCanonicoId)?.produtoCanonicoId ?? null;
}

function primeiroEan(obs: readonly ObservacaoLocal[]): string | null {
  return obs.find((o) => o.ean)?.ean ?? null;
}

function ultimoNormalizado(historico: readonly CompraHistorico[]): number | null {
  for (let i = historico.length - 1; i >= 0; i--) {
    const h = historico[i];
    if (h?.precoNormalizado != null) return h.precoNormalizado;
  }
  return null;
}

function primeiroNormalizado(historico: readonly CompraHistorico[]): number | null {
  for (const h of historico) {
    if (h.precoNormalizado != null) return h.precoNormalizado;
  }
  return null;
}

/** Ordena produtos para a lista: mais comprados / mais recentes primeiro. */
function ordenarProdutos(grupos: Map<string, Grupo>): ProdutoLocal[] {
  return [...grupos.values()]
    .map((g) => g.produto)
    .sort((a, b) => b.nObservacoes - a.nObservacoes || a.nome.localeCompare(b.nome));
}

/** Catálogo completo do usuário (tela Produtos / chips de Verificar). */
export async function carregarCatalogo(): Promise<ProdutoLocal[]> {
  const [observacoes, resumos] = await Promise.all([
    produtos.listarObservacoes(),
    cache.mapaDeResumos(),
  ]);
  return ordenarProdutos(agrupar(observacoes, resumos));
}

/** Produto + histórico por chave (tela Detalhe). */
export async function obterProduto(
  chave: string,
): Promise<{ produto: ProdutoLocal; historico: CompraHistorico[] } | null> {
  const [observacoes, resumos] = await Promise.all([
    produtos.listarObservacoes(),
    cache.mapaDeResumos(),
  ]);
  return agrupar(observacoes, resumos).get(chave) ?? null;
}
