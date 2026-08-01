/**
 * C3.5 — Casamento de produto por TEXTO (itens sem EAN: hortifruti, padaria,
 * açougue). O casamento por EAN (C3.4) já roda na ingestão (C2); aqui tratamos
 * o que não tem código de barras.
 *
 * Regra travada (docs/06): um casamento por texto **nunca** vira referência
 * sozinho — gera uma sugestão de `produto_alias` com score, que só passa a valer
 * depois de **confirmado** (usuário/curadoria). Por isso este módulo apenas
 * SUGERE; quem grava `produto_alias` decide confirmar.
 *
 * Similaridade = blend de dois sinais robustos a variação de escrita:
 *  • Jaccard de TOKENS  → captura "mesmas palavras" (ordem não importa).
 *  • Dice de TRIGRAMAS  → tolera erro de digitação/abreviação.
 * Limiares marcados como **a calibrar com dados reais** (docs/06; data-scientist).
 */

import { normalizarDescricao } from '../anonimizacao/normalizacao';

export const LIMIARES_TEXTO = {
  /** Abaixo disto não sugerimos casamento (ruído). */
  similaridadeMinima: 0.45,
  /** Peso do Jaccard de tokens no blend (o resto vai p/ os trigramas). */
  pesoTokens: 0.6,
} as const;

/** Tokens normalizados (sem acento, maiúsculas), descartando ruído de 1 char. */
export function tokenizar(texto: string): string[] {
  return normalizarDescricao(texto)
    .split(/[^0-9A-Z]+/u)
    .filter((t) => t.length > 1);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersecao = 0;
  for (const x of a) if (b.has(x)) intersecao++;
  const uniao = a.size + b.size - intersecao;
  return uniao === 0 ? 0 : intersecao / uniao;
}

/** Trigramas de caracteres da string normalizada (com bordas). */
export function trigramas(texto: string): Set<string> {
  const s = `  ${normalizarDescricao(texto).replace(/\s+/g, ' ')} `;
  const grams = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) grams.add(s.slice(i, i + 3));
  return grams;
}

function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersecao = 0;
  for (const x of a) if (b.has(x)) intersecao++;
  return (2 * intersecao) / (a.size + b.size);
}

/** Similaridade 0..1 entre duas descrições (blend de tokens + trigramas). */
export function similaridade(a: string, b: string): number {
  const jt = jaccard(new Set(tokenizar(a)), new Set(tokenizar(b)));
  const dt = dice(trigramas(a), trigramas(b));
  const w = LIMIARES_TEXTO.pesoTokens;
  return w * jt + (1 - w) * dt;
}

/** Produto de referência candidato ao casamento por texto. */
export interface CandidatoCanonico {
  produtoCanonicoId: string;
  descricaoNormalizada: string;
}

export interface SugestaoCasamento {
  produtoCanonicoId: string;
  /** Score de similaridade (vira `produto_alias.confianca`). */
  confianca: number;
}

/**
 * Sugere casamentos para uma descrição, ordenados por confiança desc. Filtra
 * abaixo do limiar e limita a `maxSugestoes`. Lista vazia = nada plausível
 * (provável produto novo a cadastrar).
 */
export function sugerirCasamento(
  descricao: string,
  candidatos: readonly CandidatoCanonico[],
  opcoes: { limiar?: number; maxSugestoes?: number } = {},
): SugestaoCasamento[] {
  const limiar = opcoes.limiar ?? LIMIARES_TEXTO.similaridadeMinima;
  const max = opcoes.maxSugestoes ?? 3;
  return candidatos
    .map((c) => ({
      produtoCanonicoId: c.produtoCanonicoId,
      confianca: Math.round(similaridade(descricao, c.descricaoNormalizada) * 1e4) / 1e4,
    }))
    .filter((s) => s.confianca >= limiar)
    .sort((a, b) => b.confianca - a.confianca)
    .slice(0, max);
}

/** Fonte de candidatos para o casamento (produtos de referência já conhecidos). */
export interface FonteCandidatosTexto {
  /** Candidatos da mesma unidade-base (kg/L/un) reduzem falso positivo. */
  listarCandidatos(unidadeBase: string): Promise<CandidatoCanonico[]>;
  /**
   * Confirma uma sugestão de casamento, gravando um `produto_alias` confirmado.
   * Devolve o `aliasId` para referência.
   */
  confirmarCasamento(
    produtoCanonicoId: string,
    confianca: number,
    textoOriginal: string,
  ): Promise<string>;
}

/**
 * Orquestra a sugestão sobre os candidatos vindos da persistência. Continua
 * sem gravar nada: a confirmação (criar `produto_alias` confirmado) é um passo
 * de curadoria à parte (UI futura), preservando a regra de docs/06.
 */
export class MatcherTexto {
  constructor(
    private readonly fonte: FonteCandidatosTexto,
    private readonly opcoes: { limiar?: number; maxSugestoes?: number } = {},
  ) {}

  async sugerir(descricao: string, unidadeBase: string): Promise<SugestaoCasamento[]> {
    const candidatos = await this.fonte.listarCandidatos(unidadeBase);
    return sugerirCasamento(descricao, candidatos, this.opcoes);
  }
}
