/**
 * C3 — Ferramenta de CALIBRAÇÃO do motor de agregação (docs/06, "a calibrar com
 * dados reais").
 *
 * Por que existe: `DECAIMENTO.meiaVidaDias` (30), `DECAIMENTO.fatorCercoPromo`
 * (1,5) e `MIN_OBSERVACOES_FALLBACK` são chutes iniciais defensáveis, não
 * números medidos. Este módulo MEDE o que cada valor alternativo teria feito
 * sobre o pool real e RECOMENDA um. Ele não decide nada: não altera constante,
 * não escreve no banco. Aplicar uma recomendação é decisão humana, num commit
 * separado — a mediana do veredito não muda por si só.
 *
 * Tudo aqui é puro (sem I/O), como `agregacao.ts`. Enquanto o pool do beta for
 * raso, o resultado honesto é "dados insuficientes": nenhuma função inventa
 * número nem lança exceção por falta de base.
 *
 * As três medições, e por que cada uma:
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
 */

import { type EscopoGeo, mediana, type UnidadeBase } from '@barganha/shared';

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

  const recalls = new Map<number, number[]>(FATORES_CERCO_CANDIDATOS.map((k) => [k, [] as number[]]));
  const fps = new Map<number, number[]>(FATORES_CERCO_CANDIDATOS.map((k) => [k, [] as number[]]));
  let gruposAvaliados = 0;

  for (const grupo of grupos) {
    const amostras = prepararAmostras(grupo.observacoes, refMs, maxIdadeDias);
    const declaradas = amostras.filter((a) => a.emPromocao);
    const regulares = amostras.filter((a) => !a.emPromocao);
    if (regulares.length < MIN_REGULARES_CERCO || declaradas.length < MIN_DECLARADAS_CERCO) continue;

    const q1 = percentilTemporal(regulares, refMs, meiaVidaDias, 0.25);
    const q3 = percentilTemporal(regulares, refMs, meiaVidaDias, 0.75);
    const iqr = q3 - q1;
    // IQR zero (preço idêntico em todo o grupo): o cerco não depende de `k`, o
    // grupo não distingue candidato nenhum e só diluiria a agregação.
    if (!Number.isFinite(iqr) || iqr <= 0) continue;

    gruposAvaliados++;
    for (const fator of FATORES_CERCO_CANDIDATOS) {
      const cerco = q1 - fator * iqr;
      recalls.get(fator)!.push(declaradas.filter((a) => a.valor < cerco).length / declaradas.length);
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
        const medianas: number[] = [];
        for (let b = 0; b < REPETICOES_BOOTSTRAP; b++) {
          const reamostra: AmostraCalibracao[] = [];
          for (let i = 0; i < n; i++) {
            reamostra.push(populacao[Math.floor(sortear() * populacao.length)]!);
          }
          medianas.push(percentilTemporal(reamostra, refMs, meiaVidaDias, 0.5));
        }
        const amplitude =
          (percentilSimples(medianas, 0.75) - percentilSimples(medianas, 0.25)) / medianaPopulacao;
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
