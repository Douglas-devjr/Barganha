/**
 * C3.1 + C3.2 + C3.6 — Agregação estatística (núcleo, funções puras).
 *
 * Recebe as `observacao_preco` de um produto num escopo e devolve a faixa
 * típica: **mediana, p25, p75, mín, máx, menor_promocional, n** (docs/06).
 *
 * Decisões travadas:
 *  • MEDIANA/PERCENTIS, nunca média (robusto a outlier/promoção).
 *  • DECAIMENTO TEMPORAL (C3.2): preço recente pesa mais que antigo. Peso por
 *    meia-vida exponencial; observações fora da janela são descartadas.
 *  • PROMOÇÃO em 3 camadas (C3.6): (1) sinal da NFC-e (`emPromocao`), (2)
 *    detecção estatística por cerco IQR, (3) o típico é calculado SÓ sobre a
 *    base regular; o menor promocional sai à parte (nunca colapsa no número).
 *
 * Tudo aqui é puro e sem I/O — o pipeline (pipeline.ts) liga isto à persistência.
 * Limiares marcados como **a calibrar com dados reais** (docs/06; data-scientist).
 */

const DIA_MS = 86_400_000;

/** Parâmetros de calibração do motor — ajustar com dados reais (docs/06). */
export const DECAIMENTO = {
  /** Meia-vida do peso temporal, em dias (~1 mês; docs/06 fala "algumas semanas"). */
  meiaVidaDias: 30,
  /** Janela: observações mais antigas que isto são descartadas (~6 meses). */
  maxIdadeDias: 180,
  /** Fator do cerco IQR p/ promoção estatística: abaixo de `p25 − k·(p75−p25)`. */
  fatorCercoPromo: 1.5,
} as const;

/** Observação mínima necessária para agregar (já normalizada em R$/unidade_base). */
export interface ObservacaoAgregavel {
  precoNormalizado: number;
  emPromocao: boolean;
  /** Data de emissão da nota (ISO 8601) — base do decaimento temporal. */
  observadoEm: string;
}

export interface OpcoesAgregacao {
  /** "Agora" para o cálculo de idade/decaimento (injetável p/ testes determinísticos). */
  referencia: Date;
  meiaVidaDias?: number;
  maxIdadeDias?: number;
  fatorCercoPromo?: number;
}

/** Faixa típica resultante. `undefined` em `agregar` quando não há base válida. */
export interface EstatisticaCalculada {
  mediana: number;
  p25: number;
  p75: number;
  minimo: number;
  maximo: number;
  /** Menor preço promocional visto (declarado OU detectado) — à parte do típico. */
  menorPromocional?: number;
  /** Nº de observações regulares que sustentam o típico (confiança). */
  nObservacoes: number;
}

interface Amostra {
  valor: number;
  peso: number;
}

/** Arredonda para 4 casas (evita ruído de ponto flutuante no R$/base). */
function arredondar(valor: number): number {
  return Math.round(valor * 1e4) / 1e4;
}

/**
 * Peso temporal por meia-vida exponencial: `2^(−idade/meiaVida)`. Idade 0 → 1;
 * a cada `meiaVida` dias o peso cai pela metade. Idade negativa (futuro) → 1.
 */
export function pesoTemporal(idadeDias: number, meiaVidaDias: number): number {
  if (idadeDias <= 0) return 1;
  return Math.pow(2, -idadeDias / meiaVidaDias);
}

/**
 * Percentil PONDERADO com interpolação linear (método do ponto médio do peso
 * acumulado — análogo ao `percentile_cont`, mas honrando os pesos). Requer a
 * lista já ordenada por valor e `pesoTotal > 0`.
 */
export function percentilPonderado(
  ordenadas: readonly Amostra[],
  pesoTotal: number,
  p: number,
): number {
  const n = ordenadas.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return ordenadas[0]!.valor;

  // Posição normalizada (0..1) de cada amostra: peso acumulado até o seu meio.
  const posicoes = new Array<number>(n);
  let acumulado = 0;
  for (let i = 0; i < n; i++) {
    const a = ordenadas[i]!;
    posicoes[i] = (acumulado + a.peso / 2) / pesoTotal;
    acumulado += a.peso;
  }

  if (p <= posicoes[0]!) return ordenadas[0]!.valor;
  if (p >= posicoes[n - 1]!) return ordenadas[n - 1]!.valor;

  for (let i = 1; i < n; i++) {
    const pos = posicoes[i]!;
    if (p <= pos) {
      const posAnt = posicoes[i - 1]!;
      const t = pos === posAnt ? 0 : (p - posAnt) / (pos - posAnt);
      const vAnt = ordenadas[i - 1]!.valor;
      return vAnt + t * (ordenadas[i]!.valor - vAnt);
    }
  }
  return ordenadas[n - 1]!.valor;
}

interface AmostraDatada extends Amostra {
  emPromocao: boolean;
}

function ordenarPorValor(amostras: readonly AmostraDatada[]): AmostraDatada[] {
  return [...amostras].sort((a, b) => a.valor - b.valor);
}

function somaPesos(amostras: readonly Amostra[]): number {
  return amostras.reduce((acc, a) => acc + a.peso, 0);
}

/**
 * Agrega observações numa faixa típica. Retorna `undefined` quando, após o
 * filtro de janela/validade, não sobra nenhuma observação utilizável.
 */
export function agregar(
  observacoes: readonly ObservacaoAgregavel[],
  opcoes: OpcoesAgregacao,
): EstatisticaCalculada | undefined {
  const meiaVida = opcoes.meiaVidaDias ?? DECAIMENTO.meiaVidaDias;
  const maxIdade = opcoes.maxIdadeDias ?? DECAIMENTO.maxIdadeDias;
  const fator = opcoes.fatorCercoPromo ?? DECAIMENTO.fatorCercoPromo;
  const ref = opcoes.referencia.getTime();

  // 1) Filtra inválidas e fora da janela; aplica o peso temporal (C3.2).
  const amostras: AmostraDatada[] = [];
  for (const o of observacoes) {
    if (!Number.isFinite(o.precoNormalizado) || o.precoNormalizado <= 0) continue;
    const ms = Date.parse(o.observadoEm);
    if (Number.isNaN(ms)) continue;
    const idadeDias = (ref - ms) / DIA_MS;
    if (idadeDias > maxIdade) continue; // antiga demais
    amostras.push({
      valor: o.precoNormalizado,
      peso: pesoTemporal(idadeDias, meiaVida),
      emPromocao: o.emPromocao,
    });
  }
  if (amostras.length === 0) return undefined;

  // 2) Promoção camada 1: separa o que a NFC-e já marcou como promoção.
  const promoDeclarada = amostras.filter((a) => a.emPromocao);
  let regular = amostras.filter((a) => !a.emPromocao);
  // Se TUDO veio marcado como promoção, não dá p/ ter um típico de nada:
  // trata o conjunto inteiro como regular (e ainda assim expõe o menor promocional).
  if (regular.length === 0) regular = amostras;

  // 3) Promoção camada 2: cerco IQR sobre o regular — preços bem abaixo do p25
  //    formam o "cacho" promocional e são segregados do típico (docs/06).
  const ordReg = ordenarPorValor(regular);
  const pesoReg = somaPesos(ordReg);
  const q1 = percentilPonderado(ordReg, pesoReg, 0.25);
  const q3 = percentilPonderado(ordReg, pesoReg, 0.75);
  const cercoInferior = q1 - fator * (q3 - q1);

  const promoEstatistica = regular.filter((a) => a.valor < cercoInferior);
  const baseRegular = regular.filter((a) => a.valor >= cercoInferior);
  // Não deixa o cerco esvaziar a base (ex.: todos iguais e um abaixo).
  const base = baseRegular.length > 0 ? baseRegular : regular;

  // 4) Estatística final sobre a base regular.
  const ordBase = ordenarPorValor(base);
  const pesoBase = somaPesos(ordBase);
  const mediana = percentilPonderado(ordBase, pesoBase, 0.5);
  const p25 = percentilPonderado(ordBase, pesoBase, 0.25);
  const p75 = percentilPonderado(ordBase, pesoBase, 0.75);
  const minimo = ordBase[0]!.valor;
  const maximo = ordBase[ordBase.length - 1]!.valor;

  // 5) Promoção camada 3 (dado): menor visto entre declaradas ∪ detectadas.
  const promocoes = [...promoDeclarada, ...promoEstatistica];
  const menorPromocional =
    promocoes.length > 0 ? Math.min(...promocoes.map((a) => a.valor)) : undefined;

  return {
    mediana: arredondar(mediana),
    p25: arredondar(p25),
    p75: arredondar(p75),
    minimo: arredondar(minimo),
    maximo: arredondar(maximo),
    ...(menorPromocional != null ? { menorPromocional: arredondar(menorPromocional) } : {}),
    nObservacoes: base.length,
  };
}
