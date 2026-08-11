/**
 * C3/C3.6 — Ferramenta de CALIBRAÇÃO do motor de agregação e da zona morta do
 * veredito (docs/06, "a calibrar com dados reais").
 *
 * Por que existe: `DECAIMENTO.meiaVidaDias` (30), `DECAIMENTO.fatorCercoPromo`
 * (1,5), `MIN_OBSERVACOES_FALLBACK` e `ZONA_MORTA_POR_FAMILIA` são chutes
 * iniciais defensáveis, não números medidos. Este módulo MEDE o que cada valor
 * alternativo teria feito sobre o pool real e RECOMENDA um. Ele não decide
 * nada: não altera constante, não escreve no banco. Aplicar uma recomendação é
 * decisão humana, num commit separado — a mediana do veredito não muda por si só.
 *
 * Tudo aqui é puro (sem I/O), como `agregacao.ts`. Enquanto o pool do beta for
 * raso, o resultado honesto é "dados insuficientes": nenhuma função inventa
 * número nem lança exceção por falta de base.
 *
 * As quatro medições, e por que cada uma:
 *  1. MEIA-VIDA — backtest walk-forward. A meia-vida boa é a que faz a mediana
 *     de ONTEM prever melhor o preço de HOJE. Isso é mensurável sem ground
 *     truth externo: basta esconder o futuro de cada grupo e comparar.
 *  2. CERCO DE PROMOÇÃO — a flag `emPromocao` da NFC-e é ground truth (camada 1
 *     do `agregar()`). O `k` bom é o que faz a detecção estatística (camada 2)
 *     alcançar as promoções JÁ declaradas — cobertura para quando o portal não
 *     marcar desconto — sem varrer preço regular para fora do típico.
 *  3. MÍNIMO DE OBSERVAÇÕES — bootstrap POR NÍVEL de escopo. A dispersão de
 *     preço cresce com a amplitude geográfica (uma loja tem um preço; uma UF
 *     tem centenas), então o mesmo `n` compra confianças diferentes em loja e
 *     em UF. Hoje o mínimo é um número global — é essa diferença que falta.
 *  4. ZONA MORTA POR CATEGORIA (C3.6) — o único parâmetro daqui que é do
 *     VEREDITO, não da agregação: quanto o preço da gôndola precisa se afastar
 *     do típico para o app opinar. Mede as duas metades separadamente, porque
 *     elas cercam ruídos diferentes: a BASE cerca o ruído da AMOSTRA (a mediana
 *     de uma célula pequena balança sozinha) e a DERIVA cerca o ruído do TEMPO
 *     (o preço andou desde que o típico foi observado). Por família de
 *     categoria — `fresco` é reprecificado toda semana, café não.
 */

import {
  type EscopoGeo,
  type FamiliaZonaMorta,
  FAMILIAS_ZONA_MORTA,
  familiaDeCategoria,
  mediana,
  type UnidadeBase,
  ZONA_MORTA_POR_FAMILIA,
} from '@barganha/shared';

import { DECAIMENTO, percentilPonderado, pesoTemporal } from './agregacao';
import {
  derivarEscopos,
  MIN_OBSERVACOES_FALLBACK,
  ORDEM_FALLBACK,
  type ResolvedorRegiao,
} from './escopos';
import type { ObservacaoParaAgregacao } from './tipos';

const DIA_MS = 86_400_000;

// ───────────────────────────── Parâmetros da medição ──────────────────────
// Os limiares-alvo abaixo são o CRITÉRIO DE ESCOLHA, não a resposta: o
// data-scientist pode reajustá-los à luz do que o beta mostrar. O que não muda
// é o método — medir antes de trocar a constante que decide o veredito.

/** Meias-vidas testadas no backtest (dias). */
export const MEIAS_VIDAS_CANDIDATAS: readonly number[] = [7, 14, 21, 30, 45, 60, 90, 120];
/** Piso de observações para um grupo poder ser dividido em treino/teste. */
export const MIN_OBSERVACOES_BACKTEST = 12;
/** Fatia final do intervalo de tempo do grupo reservada como "futuro" (teste). */
export const FRACAO_TESTE_BACKTEST = 0.2;

/** Fatores do cerco IQR testados (`p25 − k·IQR`). */
export const FATORES_CERCO_CANDIDATOS: readonly number[] = [1, 1.5, 2, 2.5, 3];
/**
 * Recall mínimo aceitável: ao menos metade das promoções DECLARADAS também
 * seria pega pelo cerco. É a garantia de cobertura para o portal que não
 * informa desconto — se nem as declaradas caem no cerco, a camada 2 não protege
 * nada.
 */
export const RECALL_ALVO_CERCO = 0.5;
/** Teto de falso-positivo: fração de preço REGULAR segregada indevidamente. */
export const FP_MAXIMO_CERCO = 0.05;
/** Piso de base regular p/ o IQR do grupo significar alguma coisa. */
export const MIN_REGULARES_CERCO = 8;
/** Piso de promoções declaradas p/ o recall do grupo não ser 0% ou 100% por sorte. */
export const MIN_DECLARADAS_CERCO = 2;

/** Mínimos de observação testados no bootstrap. */
export const NS_CANDIDATOS: readonly number[] = [3, 5, 8, 12, 20, 30];
/** Tamanho de pool para um grupo servir de "população" de referência. */
export const N_MINIMO_POOL_BOOTSTRAP = 30;
/** Reamostragens por (grupo × n) — 200 estabiliza o IQR sem custar minutos. */
export const REPETICOES_BOOTSTRAP = 200;
/** Alvo: IQR das medianas reamostradas ≤ 15% da mediana da população. */
export const AMPLITUDE_RELATIVA_ALVO = 0.15;
/**
 * Semente fixa do sorteio. Duas rodadas sobre a mesma base têm que dar a MESMA
 * recomendação — uma ferramenta de medição que oscila sozinha não é auditável.
 */
export const SEMENTE_BOOTSTRAP = 20_260_802;

/** Bases de zona morta testadas (fração da mediana). */
export const BASES_ZONA_MORTA_CANDIDATAS: readonly number[] = [0.03, 0.05, 0.07, 0.1, 0.15];
/** Derivas mensais testadas (fração da mediana por mês de idade do típico). */
export const DERIVAS_MENSAIS_CANDIDATAS: readonly number[] = [0.005, 0.008, 0.012, 0.02, 0.03];
/**
 * Piso da base: os 5% de percepção/relevância de `LIMIARES_VEREDITO` NÃO são
 * mensuráveis a partir do pool — vêm de quanto o ser humano percebe de
 * diferença de preço e de quanto muda a decisão dele na gôndola (docs/06). O
 * pool só sabe dizer se a base precisa ser MAIOR que isso por causa de ruído de
 * amostra; nunca que pode ser menor.
 */
export const BASE_MINIMA_ZONA_MORTA = 0.05;
/**
 * Nível de escopo medido. Um só, de propósito: a mesma observação vive em
 * loja/município/região/UF ao mesmo tempo (ver `agruparParaCalibracao`), e medir
 * nos quatro contaria cada preço quatro vezes com a UF — que agrega todo mundo —
 * dominando a recomendação. `municipio` é o nível principal do produto (docs/06)
 * e o que a maioria das telas consome.
 */
export const ESCOPO_ZONA_MORTA: EscopoGeo = 'municipio';
/** Tamanho de célula de referência p/ medir o balanço da mediana (célula típica servida). */
export const N_REFERENCIA_ZONA_MORTA = 8;
/** Piso de observações regulares no grupo p/ ele entrar na medição da base. */
export const MIN_OBSERVACOES_ZONA_MORTA = 12;
/**
 * Percentil do ruído entre os grupos da família que a base precisa cobrir. p75
 * e não a mediana: a base é uma trava de segurança, e uma trava dimensionada
 * para o caso mediano deixa metade dos produtos da família opinando sobre ruído.
 */
export const PERCENTIL_RUIDO_ZONA_MORTA = 0.75;
/** Vão mínimo (dias) entre o miolo do terço velho e o do novo p/ a deriva significar %/mês. */
export const MIN_DIAS_VAO_DERIVA = 45;
/** Piso de observações regulares p/ dividir o grupo em terços de tempo. */
export const MIN_OBSERVACOES_DERIVA = 9;

// ────────────────────────────────── Entrada ───────────────────────────────

/** Um pool comparável: mesmo produto, mesma unidade-base, mesmo escopo geo. */
export interface GrupoCalibracao {
  produtoCanonicoId: string;
  unidadeBase: UnidadeBase;
  escopo: EscopoGeo;
  escopoId: string;
  observacoes: readonly ObservacaoParaAgregacao[];
}

export interface OpcoesCalibracao {
  /** "Agora" da janela/decaimento (injetável p/ medições determinísticas). */
  referencia?: Date;
  /** Meia-vida usada nos pesos das medições 2 e 3 (default: a vigente). */
  meiaVidaDias?: number;
  /** Janela máxima considerada (default: a vigente — o que o motor enxerga). */
  maxIdadeDias?: number;
}

/** Recomendação de UM parâmetro. `valorRecomendado` ausente = não deu para medir. */
export interface RecomendacaoCalibravel<T> {
  valorAtual: T;
  valorRecomendado?: T;
  /** Grupos que de fato entraram na conta — transparência sobre a base. */
  amostrasAvaliadas: number;
  /** Frase pronta para o relatório humano. */
  detalhe: string;
}

/**
 * Agrupa observações soltas em (produto × unidade-base × escopo), a MESMA
 * chave que o pipeline usa para gravar `preco_estatistica` — calibrar sobre
 * outro recorte calibraria outra coisa. A derivação dos escopos vem de
 * `derivarEscopos` (não se duplica aqui): uma observação alimenta loja,
 * município, região e UF ao mesmo tempo.
 */
export function agruparParaCalibracao(
  observacoes: readonly ObservacaoParaAgregacao[],
  resolverRegiao?: ResolvedorRegiao,
): GrupoCalibracao[] {
  const grupos = new Map<string, GrupoCalibracao & { observacoes: ObservacaoParaAgregacao[] }>();
  for (const o of observacoes) {
    const escopos = derivarEscopos(
      {
        lojaCnpj: o.lojaCnpj,
        ...(o.municipio ? { municipio: o.municipio } : {}),
        ...(o.uf ? { uf: o.uf } : {}),
      },
      resolverRegiao,
    );
    for (const { escopo, escopoId } of escopos) {
      const chave = `${o.produtoCanonicoId}|${o.unidadeBase}|${escopo}|${escopoId}`;
      let grupo = grupos.get(chave);
      if (!grupo) {
        grupo = {
          produtoCanonicoId: o.produtoCanonicoId,
          unidadeBase: o.unidadeBase,
          escopo,
          escopoId,
          observacoes: [],
        };
        grupos.set(chave, grupo);
      }
      grupo.observacoes.push(o);
    }
  }
  return [...grupos.values()];
}

// ───────────────────────────── Utilitários internos ───────────────────────

interface AmostraCalibracao {
  valor: number;
  observadoMs: number;
  emPromocao: boolean;
}

/** Aplica os mesmos filtros de `agregar()` (preço válido, dentro da janela) e ordena no tempo. */
function prepararAmostras(
  observacoes: readonly ObservacaoParaAgregacao[],
  refMs: number,
  maxIdadeDias: number,
): AmostraCalibracao[] {
  const amostras: AmostraCalibracao[] = [];
  for (const o of observacoes) {
    if (!Number.isFinite(o.precoNormalizado) || o.precoNormalizado <= 0) continue;
    const ms = Date.parse(o.observadoEm);
    if (Number.isNaN(ms)) continue;
    if ((refMs - ms) / DIA_MS > maxIdadeDias) continue;
    amostras.push({ valor: o.precoNormalizado, observadoMs: ms, emPromocao: o.emPromocao });
  }
  amostras.sort((a, b) => a.observadoMs - b.observadoMs);
  return amostras;
}

/** Percentil ponderado pelo decaimento temporal — o MESMO cálculo do motor. */
function percentilTemporal(
  amostras: readonly AmostraCalibracao[],
  refMs: number,
  meiaVidaDias: number,
  p: number,
): number {
  if (amostras.length === 0) return Number.NaN;
  const ordenadas = amostras
    .map((a) => ({
      valor: a.valor,
      peso: pesoTemporal((refMs - a.observadoMs) / DIA_MS, meiaVidaDias),
    }))
    .sort((x, y) => x.valor - y.valor);
  const pesoTotal = ordenadas.reduce((acc, a) => acc + a.peso, 0);
  if (!(pesoTotal > 0)) return Number.NaN;
  return percentilPonderado(ordenadas, pesoTotal, p);
}

/** Percentil simples (peso 1) — reusa o ponderado para não ter dois métodos de percentil. */
function percentilSimples(valores: readonly number[], p: number): number {
  if (valores.length === 0) return Number.NaN;
  const ordenadas = [...valores].sort((a, b) => a - b).map((valor) => ({ valor, peso: 1 }));
  return percentilPonderado(ordenadas, ordenadas.length, p);
}

/**
 * Agrega uma métrica através dos grupos pela MEDIANA, nunca pela média (decisão
 * travada nº6, aplicada também aqui): um produto com mil observações não pode
 * ditar sozinho o parâmetro que vale para todos os outros.
 */
function agregarPorGrupo(valores: readonly number[]): number {
  return mediana(valores) ?? Number.NaN;
}

function pct(fracao: number): string {
  return `${(fracao * 100).toFixed(1)}%`;
}

/**
 * Quanto a mediana de uma célula de `n` observações BALANÇA, em fração da
 * mediana da população: IQR das medianas reamostradas com reposição ÷ mediana
 * da população. Compartilhado pelas medições 3 e 4 — as duas perguntam a mesma
 * coisa (o quanto o típico é firme com `n` pequeno), só que uma escolhe o `n` e
 * a outra fixa o `n` e lê o balanço.
 */
function amplitudeRelativaBootstrap(
  populacao: readonly AmostraCalibracao[],
  n: number,
  medianaPopulacao: number,
  sortear: () => number,
  refMs: number,
  meiaVidaDias: number,
): number {
  const medianas: number[] = [];
  for (let b = 0; b < REPETICOES_BOOTSTRAP; b++) {
    const reamostra: AmostraCalibracao[] = [];
    for (let i = 0; i < n; i++) {
      reamostra.push(populacao[Math.floor(sortear() * populacao.length)]!);
    }
    medianas.push(percentilTemporal(reamostra, refMs, meiaVidaDias, 0.5));
  }
  return (percentilSimples(medianas, 0.75) - percentilSimples(medianas, 0.25)) / medianaPopulacao;
}

/** PRNG determinístico (mulberry32) — ver `SEMENTE_BOOTSTRAP`. */
function criarSorteio(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ──────────────────────── 1) Meia-vida do decaimento ──────────────────────

export interface ErroPorMeiaVida {
  meiaVidaDias: number;
  /** MAPE mediano entre os grupos (0..1). `NaN` quando nenhum grupo pontuou. */
  mapeMediano: number;
}

export interface ResultadoMeiaVida extends RecomendacaoCalibravel<number> {
  erroPorCandidata: readonly ErroPorMeiaVida[];
}

/**
 * Backtest walk-forward: para cada grupo, esconde a fatia final do tempo
 * (`FRACAO_TESTE_BACKTEST`), calcula a mediana ponderada só com o passado — com
 * a referência no CORTE, que é o instante em que o motor teria opinado — e mede
 * o erro percentual absoluto contra cada preço do futuro escondido. A meia-vida
 * vencedora é a de menor erro agregado.
 *
 * Só a base REGULAR entra: a meia-vida governa o típico, e promoção declarada é
 * segregada dele pelo `agregar()`. Deixá-la aqui mediria a sorte de o teste cair
 * numa semana de oferta.
 */
export function calibrarMeiaVida(
  grupos: readonly GrupoCalibracao[],
  opcoes: OpcoesCalibracao = {},
): ResultadoMeiaVida {
  const refMs = (opcoes.referencia ?? new Date()).getTime();
  const maxIdadeDias = opcoes.maxIdadeDias ?? DECAIMENTO.maxIdadeDias;

  const mapesPorCandidata = new Map<number, number[]>(
    MEIAS_VIDAS_CANDIDATAS.map((mv) => [mv, [] as number[]]),
  );
  let gruposAvaliados = 0;

  for (const grupo of grupos) {
    const amostras = prepararAmostras(grupo.observacoes, refMs, maxIdadeDias).filter(
      (a) => !a.emPromocao,
    );
    if (amostras.length < MIN_OBSERVACOES_BACKTEST) continue;

    const inicioMs = amostras[0]!.observadoMs;
    const fimMs = amostras[amostras.length - 1]!.observadoMs;
    if (fimMs <= inicioMs) continue; // tudo no mesmo instante: não há futuro a prever

    const corteMs = inicioMs + (fimMs - inicioMs) * (1 - FRACAO_TESTE_BACKTEST);
    const treino = amostras.filter((a) => a.observadoMs <= corteMs);
    const teste = amostras.filter((a) => a.observadoMs > corteMs);
    if (treino.length < 3 || teste.length === 0) continue;

    gruposAvaliados++;
    for (const meiaVidaDias of MEIAS_VIDAS_CANDIDATAS) {
      const previsto = percentilTemporal(treino, corteMs, meiaVidaDias, 0.5);
      if (!Number.isFinite(previsto)) continue;
      // MAPE do grupo: média dos erros relativos dentro do grupo (todos os
      // pontos do futuro do grupo pesam igual); a agregação ENTRE grupos é que
      // usa mediana.
      const soma = teste.reduce((acc, a) => acc + Math.abs(a.valor - previsto) / a.valor, 0);
      mapesPorCandidata.get(meiaVidaDias)!.push(soma / teste.length);
    }
  }

  const erroPorCandidata: ErroPorMeiaVida[] = MEIAS_VIDAS_CANDIDATAS.map((meiaVidaDias) => ({
    meiaVidaDias,
    mapeMediano: agregarPorGrupo(mapesPorCandidata.get(meiaVidaDias)!),
  }));

  const valorAtual = DECAIMENTO.meiaVidaDias;
  const validas = erroPorCandidata.filter((e) => Number.isFinite(e.mapeMediano));
  if (gruposAvaliados === 0 || validas.length === 0) {
    return {
      valorAtual,
      amostrasAvaliadas: gruposAvaliados,
      detalhe:
        `sem base: nenhum grupo tem ${MIN_OBSERVACOES_BACKTEST}+ observações regulares ` +
        'espalhadas no tempo para dividir em treino/teste',
      erroPorCandidata,
    };
  }

  const melhor = validas.reduce((a, b) => (b.mapeMediano < a.mapeMediano ? b : a));
  const atual = erroPorCandidata.find((e) => e.meiaVidaDias === valorAtual);
  const comparacao =
    atual && Number.isFinite(atual.mapeMediano)
      ? ` (atual ${valorAtual}d: MAPE ${pct(atual.mapeMediano)})`
      : '';
  return {
    valorAtual,
    valorRecomendado: melhor.meiaVidaDias,
    amostrasAvaliadas: gruposAvaliados,
    detalhe: `meia-vida ${melhor.meiaVidaDias}d: MAPE ${pct(melhor.mapeMediano)}${comparacao}`,
    erroPorCandidata,
  };
}

// ─────────────────────── 2) Fator do cerco de promoção ────────────────────

export interface MetricaCerco {
  fator: number;
  /** Fração das promoções DECLARADAS que o cerco também pegaria (0..1). */
  recallMediano: number;
  /** Fração de preço REGULAR que o cerco segregaria por engano (0..1). */
  fpMedianoRegular: number;
}

export interface ResultadoCerco extends RecomendacaoCalibravel<number> {
  metricaPorCandidato: readonly MetricaCerco[];
}

/**
 * Confronta o cerco IQR (camada 2) com a promoção declarada pela NFC-e (camada
 * 1, ground truth). Para cada `k`, mede recall sobre as declaradas e
 * falso-positivo sobre as regulares, e escolhe o MENOR `k` que atinge o recall
 * alvo sem estourar o teto de falso-positivo — `k` menor aperta o cerco para
 * cima (`p25 − k·IQR` sobe), pegando mais promoção e, junto, mais preço
 * regular; é o teto de FP que segura a mão.
 *
 * Recall e FP são contagens simples (uma observação, um voto): aqui se mede
 * comportamento de DETECÇÃO, não nível de preço — o peso temporal já entrou
 * onde importa, no p25/p75 que definem o cerco.
 */
export function calibrarFatorCerco(
  grupos: readonly GrupoCalibracao[],
  opcoes: OpcoesCalibracao = {},
): ResultadoCerco {
  const refMs = (opcoes.referencia ?? new Date()).getTime();
  const maxIdadeDias = opcoes.maxIdadeDias ?? DECAIMENTO.maxIdadeDias;
  const meiaVidaDias = opcoes.meiaVidaDias ?? DECAIMENTO.meiaVidaDias;

  const recalls = new Map<number, number[]>(
    FATORES_CERCO_CANDIDATOS.map((k) => [k, [] as number[]]),
  );
  const fps = new Map<number, number[]>(FATORES_CERCO_CANDIDATOS.map((k) => [k, [] as number[]]));
  let gruposAvaliados = 0;

  for (const grupo of grupos) {
    const amostras = prepararAmostras(grupo.observacoes, refMs, maxIdadeDias);
    const declaradas = amostras.filter((a) => a.emPromocao);
    const regulares = amostras.filter((a) => !a.emPromocao);
    if (regulares.length < MIN_REGULARES_CERCO || declaradas.length < MIN_DECLARADAS_CERCO)
      continue;

    const q1 = percentilTemporal(regulares, refMs, meiaVidaDias, 0.25);
    const q3 = percentilTemporal(regulares, refMs, meiaVidaDias, 0.75);
    const iqr = q3 - q1;
    // IQR zero (preço idêntico em todo o grupo): o cerco não depende de `k`, o
    // grupo não distingue candidato nenhum e só diluiria a agregação.
    if (!Number.isFinite(iqr) || iqr <= 0) continue;

    gruposAvaliados++;
    for (const fator of FATORES_CERCO_CANDIDATOS) {
      const cerco = q1 - fator * iqr;
      recalls
        .get(fator)!
        .push(declaradas.filter((a) => a.valor < cerco).length / declaradas.length);
      fps.get(fator)!.push(regulares.filter((a) => a.valor < cerco).length / regulares.length);
    }
  }

  const metricaPorCandidato: MetricaCerco[] = FATORES_CERCO_CANDIDATOS.map((fator) => ({
    fator,
    recallMediano: agregarPorGrupo(recalls.get(fator)!),
    fpMedianoRegular: agregarPorGrupo(fps.get(fator)!),
  }));

  const valorAtual = DECAIMENTO.fatorCercoPromo;
  if (gruposAvaliados === 0) {
    return {
      valorAtual,
      amostrasAvaliadas: 0,
      detalhe:
        `sem base: nenhum grupo reúne ${MIN_REGULARES_CERCO}+ preços regulares e ` +
        `${MIN_DECLARADAS_CERCO}+ promoções declaradas pela NFC-e`,
      metricaPorCandidato,
    };
  }

  const escolhido = metricaPorCandidato.find(
    (m) => m.recallMediano >= RECALL_ALVO_CERCO && m.fpMedianoRegular <= FP_MAXIMO_CERCO,
  );
  if (!escolhido) {
    const melhorRecall = metricaPorCandidato.reduce((a, b) =>
      b.recallMediano > a.recallMediano ? b : a,
    );
    return {
      valorAtual,
      amostrasAvaliadas: gruposAvaliados,
      detalhe:
        `nenhum k atinge recall ${pct(RECALL_ALVO_CERCO)} com FP ≤ ${pct(FP_MAXIMO_CERCO)} — ` +
        `melhor foi k=${melhorRecall.fator} (recall ${pct(melhorRecall.recallMediano)}, ` +
        `FP ${pct(melhorRecall.fpMedianoRegular)}); rever os alvos ou esperar mais base`,
      metricaPorCandidato,
    };
  }

  return {
    valorAtual,
    valorRecomendado: escolhido.fator,
    amostrasAvaliadas: gruposAvaliados,
    detalhe:
      `k=${escolhido.fator}: recall ${pct(escolhido.recallMediano)} das promoções declaradas, ` +
      `FP ${pct(escolhido.fpMedianoRegular)} sobre o regular`,
    metricaPorCandidato,
  };
}

// ────────────────── 3) Mínimo de observações por nível de escopo ──────────

export interface AmplitudePorN {
  n: number;
  /** IQR das medianas reamostradas ÷ mediana da população (0..1). */
  amplitudeRelativa: number;
}

export interface ResultadoMinimoPorNivel extends RecomendacaoCalibravel<number> {
  escopo: EscopoGeo;
  amplitudePorCandidato: readonly AmplitudePorN[];
}

/**
 * Bootstrap por nível: em cada grupo com pool grande (`N_MINIMO_POOL_BOOTSTRAP`)
 * reamostra `n` observações com reposição, `REPETICOES_BOOTSTRAP` vezes, e mede
 * quanto a mediana estimada BALANÇA — IQR das medianas dividido pela mediana da
 * população. Recomenda, por nível, o menor `n` cujo balanço fica sob
 * `AMPLITUDE_RELATIVA_ALVO`.
 *
 * Retorna sempre uma linha por nível: um nível sem pool grande fica sem
 * recomendação sem apagar os outros — é normal município ter base e loja não.
 */
export function calibrarMinimoObservacoes(
  grupos: readonly GrupoCalibracao[],
  opcoes: OpcoesCalibracao = {},
): ResultadoMinimoPorNivel[] {
  const refMs = (opcoes.referencia ?? new Date()).getTime();
  const maxIdadeDias = opcoes.maxIdadeDias ?? DECAIMENTO.maxIdadeDias;
  const meiaVidaDias = opcoes.meiaVidaDias ?? DECAIMENTO.meiaVidaDias;
  const sortear = criarSorteio(SEMENTE_BOOTSTRAP);
  const valorAtual = MIN_OBSERVACOES_FALLBACK;

  return ORDEM_FALLBACK.map((escopo) => {
    const amplitudes = new Map<number, number[]>(NS_CANDIDATOS.map((n) => [n, [] as number[]]));
    let gruposAvaliados = 0;

    for (const grupo of grupos) {
      if (grupo.escopo !== escopo) continue;
      // População = base REGULAR: é sobre ela que o típico servido é calculado.
      const populacao = prepararAmostras(grupo.observacoes, refMs, maxIdadeDias).filter(
        (a) => !a.emPromocao,
      );
      if (populacao.length < N_MINIMO_POOL_BOOTSTRAP) continue;
      const medianaPopulacao = percentilTemporal(populacao, refMs, meiaVidaDias, 0.5);
      if (!Number.isFinite(medianaPopulacao) || medianaPopulacao <= 0) continue;

      gruposAvaliados++;
      for (const n of NS_CANDIDATOS) {
        const amplitude = amplitudeRelativaBootstrap(
          populacao,
          n,
          medianaPopulacao,
          sortear,
          refMs,
          meiaVidaDias,
        );
        if (Number.isFinite(amplitude)) amplitudes.get(n)!.push(amplitude);
      }
    }

    const amplitudePorCandidato: AmplitudePorN[] = NS_CANDIDATOS.map((n) => ({
      n,
      amplitudeRelativa: agregarPorGrupo(amplitudes.get(n)!),
    }));

    if (gruposAvaliados === 0) {
      return {
        escopo,
        valorAtual,
        amostrasAvaliadas: 0,
        detalhe: `sem base: nenhum pool de ${N_MINIMO_POOL_BOOTSTRAP}+ observações neste nível`,
        amplitudePorCandidato,
      };
    }

    const escolhido = amplitudePorCandidato.find(
      (a) => Number.isFinite(a.amplitudeRelativa) && a.amplitudeRelativa <= AMPLITUDE_RELATIVA_ALVO,
    );
    if (!escolhido) {
      const maior = amplitudePorCandidato[amplitudePorCandidato.length - 1]!;
      return {
        escopo,
        valorAtual,
        amostrasAvaliadas: gruposAvaliados,
        detalhe:
          `nem n=${maior.n} estabiliza a mediana (amplitude ${pct(maior.amplitudeRelativa)} > ` +
          `alvo ${pct(AMPLITUDE_RELATIVA_ALVO)}) — este nível precisa de mais que os candidatos testados`,
        amplitudePorCandidato,
      };
    }

    return {
      escopo,
      valorAtual,
      valorRecomendado: escolhido.n,
      amostrasAvaliadas: gruposAvaliados,
      detalhe:
        `n=${escolhido.n}: mediana balança ${pct(escolhido.amplitudeRelativa)} ` +
        `(alvo ≤ ${pct(AMPLITUDE_RELATIVA_ALVO)})`,
      amplitudePorCandidato,
    };
  });
}

// ──────────────── 4) Zona morta do veredito, por categoria ────────────────

export interface ResultadoZonaMorta {
  familia: FamiliaZonaMorta;
  /** Diferença mínima relevante com o dado de hoje (fração da mediana). */
  base: RecomendacaoCalibravel<number>;
  /** Crescimento da zona morta por mês de idade do típico (fração). */
  derivaMensal: RecomendacaoCalibravel<number>;
}

export interface OpcoesZonaMorta extends OpcoesCalibracao {
  /**
   * `produtoCanonicoId` → categoria (texto livre do catálogo). O que falta no
   * mapa cai na família `outros` — que é o comportamento REAL do app para esse
   * produto, então medir junto ali é o retrato certo, não um buraco.
   */
  categoriaPorProduto?: ReadonlyMap<string, string>;
}

/** Menor candidato ≥ alvo; `undefined` se nem o maior alcança. */
function menorCandidatoAcima(candidatos: readonly number[], alvo: number): number | undefined {
  return candidatos.find((c) => c >= alvo);
}

/**
 * Ruído de AMOSTRA do grupo, em fração da mediana: metade do balanço da mediana
 * numa célula de `N_REFERENCIA_ZONA_MORTA` observações.
 *
 * Por que metade: o balanço é medido como IQR das medianas reamostradas — a
 * largura da faixa p25–p75 da própria ESTIMATIVA. O que a zona morta precisa
 * cobrir é o DESVIO em relação ao centro, que é metade dessa largura. Um preço
 * de gôndola mais perto do típico do que isso não é barato nem caro: é o típico
 * tremendo.
 */
function ruidoDeAmostra(
  populacao: readonly AmostraCalibracao[],
  sortear: () => number,
  refMs: number,
  meiaVidaDias: number,
): number {
  const medianaPopulacao = percentilTemporal(populacao, refMs, meiaVidaDias, 0.5);
  if (!Number.isFinite(medianaPopulacao) || medianaPopulacao <= 0) return Number.NaN;
  const amplitude = amplitudeRelativaBootstrap(
    populacao,
    N_REFERENCIA_ZONA_MORTA,
    medianaPopulacao,
    sortear,
    refMs,
    meiaVidaDias,
  );
  return amplitude / 2;
}

/**
 * Deriva mensal ABSOLUTA do grupo: taxa geométrica entre a mediana do terço mais
 * VELHO e a do terço mais NOVO das observações, pelo vão de tempo entre os
 * miolos dos dois terços.
 *
 * Sem peso temporal aqui de propósito: o decaimento existe para dar mais voz ao
 * preço recente DENTRO de um típico, e aplicá-lo nas duas pontas encolheria
 * justamente o movimento que se quer medir.
 *
 * O sinal é descartado (valor absoluto): a zona morta não sabe se o mercado vai
 * subir ou cair, só que ele ANDA — uma categoria que cai 3% ao mês torna o
 * típico velho tão enganoso quanto uma que sobe 3%.
 */
function derivaMensalDoGrupo(populacao: readonly AmostraCalibracao[]): number {
  if (populacao.length < MIN_OBSERVACOES_DERIVA) return Number.NaN;
  const corte = Math.floor(populacao.length / 3);
  const velho = populacao.slice(0, corte); // já vem ordenado no tempo
  const novo = populacao.slice(populacao.length - corte);

  const mVelho = mediana(velho.map((a) => a.valor));
  const mNovo = mediana(novo.map((a) => a.valor));
  if (mVelho == null || mNovo == null || mVelho <= 0 || mNovo <= 0) return Number.NaN;

  const msVelho = mediana(velho.map((a) => a.observadoMs));
  const msNovo = mediana(novo.map((a) => a.observadoMs));
  if (msVelho == null || msNovo == null) return Number.NaN;
  const dias = (msNovo - msVelho) / DIA_MS;
  if (dias < MIN_DIAS_VAO_DERIVA) return Number.NaN;

  const meses = dias / 30.44;
  return Math.abs(Math.pow(mNovo / mVelho, 1 / meses) - 1);
}

/**
 * Mede as duas metades da zona morta (docs/06, C3.6) por família de categoria.
 *
 * **Base** = o piso de percepção humana (`BASE_MINIMA_ZONA_MORTA`, que o pool
 * não tem como medir) OU o ruído de amostra da família, o que for maior. Sobe
 * acima dos 5% só quando a mediana da família comprovadamente balança mais que
 * isso — e é por isso que a base pode acabar diferente entre famílias sem que
 * ninguém tenha chutado: no fresco a dispersão real é maior, e com célula
 * pequena parte dela é indistinguível de ruído.
 *
 * **Deriva** = quanto o preço da família realmente andou por mês, medido nos
 * próprios grupos. É a metade que a categoria explica melhor: o fresco é
 * reprecificado toda semana, o industrializado por tabela.
 *
 * Só a base REGULAR entra (promoção declarada é segregada do típico pelo
 * `agregar()`, e deixá-la aqui inflaria os dois números com desconto pontual).
 * Uma família sem base sai sem recomendação, sem apagar as outras.
 */
export function calibrarZonaMorta(
  grupos: readonly GrupoCalibracao[],
  opcoes: OpcoesZonaMorta = {},
): ResultadoZonaMorta[] {
  const refMs = (opcoes.referencia ?? new Date()).getTime();
  const maxIdadeDias = opcoes.maxIdadeDias ?? DECAIMENTO.maxIdadeDias;
  const meiaVidaDias = opcoes.meiaVidaDias ?? DECAIMENTO.meiaVidaDias;
  const sortear = criarSorteio(SEMENTE_BOOTSTRAP);

  const ruidos = new Map<FamiliaZonaMorta, number[]>(
    FAMILIAS_ZONA_MORTA.map((f) => [f, [] as number[]]),
  );
  const derivas = new Map<FamiliaZonaMorta, number[]>(
    FAMILIAS_ZONA_MORTA.map((f) => [f, [] as number[]]),
  );

  for (const grupo of grupos) {
    if (grupo.escopo !== ESCOPO_ZONA_MORTA) continue;
    const populacao = prepararAmostras(grupo.observacoes, refMs, maxIdadeDias).filter(
      (a) => !a.emPromocao,
    );
    if (populacao.length < MIN_OBSERVACOES_ZONA_MORTA) continue;

    const familia = familiaDeCategoria(opcoes.categoriaPorProduto?.get(grupo.produtoCanonicoId));

    const ruido = ruidoDeAmostra(populacao, sortear, refMs, meiaVidaDias);
    if (Number.isFinite(ruido)) ruidos.get(familia)!.push(ruido);

    const deriva = derivaMensalDoGrupo(populacao);
    if (Number.isFinite(deriva)) derivas.get(familia)!.push(deriva);
  }

  return FAMILIAS_ZONA_MORTA.map((familia) => {
    const atual = ZONA_MORTA_POR_FAMILIA[familia];
    const amostrasRuido = ruidos.get(familia)!;
    const amostrasDeriva = derivas.get(familia)!;

    // ── Base ──
    const ruidoFamilia = percentilSimples(amostrasRuido, PERCENTIL_RUIDO_ZONA_MORTA);
    const base: RecomendacaoCalibravel<number> =
      amostrasRuido.length === 0 || !Number.isFinite(ruidoFamilia)
        ? {
            valorAtual: atual.base,
            amostrasAvaliadas: 0,
            detalhe:
              `sem base: nenhum grupo desta família tem ${MIN_OBSERVACOES_ZONA_MORTA}+ ` +
              `observações regulares em ${ESCOPO_ZONA_MORTA}`,
          }
        : (() => {
            const alvo = Math.max(BASE_MINIMA_ZONA_MORTA, ruidoFamilia);
            const escolhido = menorCandidatoAcima(BASES_ZONA_MORTA_CANDIDATAS, alvo);
            const medido =
              `ruído de amostra ${pct(ruidoFamilia)} ` +
              `(p${Math.round(PERCENTIL_RUIDO_ZONA_MORTA * 100)} da família, célula de ` +
              `${N_REFERENCIA_ZONA_MORTA}), piso de percepção ${pct(BASE_MINIMA_ZONA_MORTA)}`;
            return escolhido == null
              ? {
                  valorAtual: atual.base,
                  amostrasAvaliadas: amostrasRuido.length,
                  detalhe:
                    `${medido} — nem o maior candidato ` +
                    `(${pct(BASES_ZONA_MORTA_CANDIDATAS[BASES_ZONA_MORTA_CANDIDATAS.length - 1]!)}) ` +
                    'cobre esse ruído; o problema aqui provavelmente é casamento de produto, ' +
                    'não veredito (docs/06)',
                }
              : {
                  valorAtual: atual.base,
                  valorRecomendado: escolhido,
                  amostrasAvaliadas: amostrasRuido.length,
                  detalhe: `${pct(escolhido)}: ${medido}`,
                };
          })();

    // ── Deriva mensal ──
    const derivaFamilia = agregarPorGrupo(amostrasDeriva);
    const derivaMensal: RecomendacaoCalibravel<number> =
      amostrasDeriva.length === 0 || !Number.isFinite(derivaFamilia)
        ? {
            valorAtual: atual.derivaMensal,
            amostrasAvaliadas: 0,
            detalhe:
              `sem base: nenhum grupo desta família cobre ${MIN_DIAS_VAO_DERIVA}+ dias com ` +
              `${MIN_OBSERVACOES_DERIVA}+ observações regulares`,
          }
        : {
            valorAtual: atual.derivaMensal,
            valorRecomendado:
              menorCandidatoAcima(DERIVAS_MENSAIS_CANDIDATAS, derivaFamilia) ??
              DERIVAS_MENSAIS_CANDIDATAS[DERIVAS_MENSAIS_CANDIDATAS.length - 1]!,
            amostrasAvaliadas: amostrasDeriva.length,
            detalhe: `preço andou ${pct(derivaFamilia)} por mês (mediana da família)`,
          };

    return { familia, base, derivaMensal };
  });
}
