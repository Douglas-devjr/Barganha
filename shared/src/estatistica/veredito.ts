/**
 * C3.6 — Motor de veredito (lado do contrato compartilhado).
 *
 * Decide, dado um preço de prateleira e a faixa típica de um produto, se ele
 * está **barato / na média / caro** — e monta o **veredito híbrido** que junta
 * dois mundos (docs/06):
 *   • REGIONAL : o típico/anônimo da sua região (colaborativo).
 *   • PESSOAL  : o que VOCÊ costuma pagar (histórico privado).
 *
 * Mora em `shared/` de propósito: o app resolve o veredito do **cache local
 * (offline)** com a MESMA lógica que o backend usaria online — sem divergência.
 *
 * Regras travadas (docs/06):
 *  • Usa MEDIANA/PERCENTIS, nunca média. O rótulo de UI é "típico".
 *  • Promoção JAMAIS colapsa no número único: vai numa linha à parte
 *    ("menor visto"), comparando a prateleira contra a faixa REGULAR (p25–p75).
 */

import type { UnidadeBase } from '../core';

/**
 * Mínimo de observações para um nível geográfico ser considerado CONFIÁVEL.
 *
 * Vive aqui porque os dois lados decidem com ele e precisam decidir IGUAL: o
 * backend no fallback hierárquico (loja→município→região→UF) e o app, offline,
 * ao escolher a melhor linha do cache. Enquanto a constante era copiada em cada
 * lado, calibrá-la significava mudar em três arquivos — e esquecer um produzia o
 * pior tipo de bug: o mesmo produto exibido como "barato" offline e "na média"
 * online, sem nada no log.
 *
 * A calibrar com dados reais (docs/06).
 */
export const MIN_OBSERVACOES_CONFIAVEL = 3;

/** Resultado da classificação. `sem_dados` = não há base suficiente p/ opinar. */
export const VEREDITOS = ['barato', 'na_media', 'caro', 'sem_dados'] as const;
export type Veredito = (typeof VEREDITOS)[number];

/**
 * Limiares do veredito — **a calibrar com dados reais** (docs/06; data-scientist).
 * Por categoria, no futuro; por ora, globais e conservadores.
 */
export const LIMIARES_VEREDITO = {
  /** Abaixo disso, o veredito é exibido com ressalva de "poucos dados". */
  minObservacoesConfiavel: 3,
  /**
   * **Zona morta**: diferença mínima vs. a mediana para o app OPINAR.
   * Dentro de ±5% do típico o veredito é sempre `na_media`.
   *
   * Existe porque o percentil sozinho não tem noção de magnitude: `< p25` é uma
   * posição, não uma diferença. Num produto de preço homogêneo (refrigerante,
   * onde toda loja cobra quase o mesmo) o p25 fica a ~1,5% da mediana — e o app
   * estampava "BARATO" por R$ 0,10 num item de R$ 8. Como 25% da população está
   * sempre abaixo do p25 **por definição**, o rótulo saía com essa frequência
   * independentemente de a economia ser real.
   *
   * Os 5% cercam três coisas ao mesmo tempo:
   *  • o ruído da própria agregação (janela de 180 dias com inflação de alimento
   *    dentro, arredondamento da normalização por kg/L, mistura de embalagens);
   *  • o limiar de percepção de diferença de preço em mercado (~5–10%);
   *  • a relevância prática — 5% num item de R$ 10 é R$ 0,50; abaixo disso o
   *    usuário não muda de decisão, e o veredito só gasta credibilidade.
   *
   * O corte é cirúrgico: rebaixa ~42% dos "barato" em produtos homogêneos
   * (onde eram ruído) e só ~1% nos de preço disperso (onde eram sinal real).
   */
  diferencaMinimaRelevante: 0.05,
} as const;

/**
 * Faixa típica de um produto num recorte (regional OU pessoal). É um subconjunto
 * estrutural de `PrecoEstatistica`, então a estatística regional serve direto;
 * o app monta a versão pessoal a partir do seu histórico local.
 */
export interface FaixaPreco {
  mediana?: number;
  p25?: number;
  p75?: number;
  /** Menor preço promocional visto — exibido à parte, nunca no típico. */
  menorPromocional?: number;
  nObservacoes: number;
  unidadeBase: UnidadeBase;
  /** Mostrado como "última atualização" (ISO 8601). */
  atualizadoEm: string;
}

/**
 * Classifica um preço de prateleira contra a faixa REGULAR.
 *
 * Duas perguntas, nesta ordem — o veredito só sai quando as duas concordam:
 *  1. **A diferença importa?** `|preço − mediana| / mediana` precisa passar de
 *     `diferencaMinimaRelevante`. É a zona morta: perto do típico, é típico.
 *  2. **Para que lado?** Aí sim os percentis decidem — `< p25` barato,
 *     `> p75` caro. A posição na distribuição respeita a dispersão REAL do
 *     produto, que um % fixo sozinho não saberia (arroz varia muito mais que
 *     refrigerante, e os dois estariam certos).
 *
 * Sem percentis (fallback degradado), a zona morta é a regra inteira: passou
 * dos 5%, o lado vem do sinal da própria diferença.
 *
 * Nunca compara contra `menorPromocional` (evita o falso "está caro" por causa
 * de uma promoção pontual antiga — docs/06).
 */
export function classificarPreco(precoPrateleira: number, faixa: FaixaPreco): Veredito {
  if (!Number.isFinite(precoPrateleira) || precoPrateleira <= 0) return 'sem_dados';
  if (faixa.nObservacoes <= 0) return 'sem_dados';

  const temPercentis = faixa.p25 != null && faixa.p75 != null;
  if (!temPercentis && faixa.mediana == null) return 'sem_dados';

  // Zona morta (só quando há mediana p/ medir a diferença contra).
  if (faixa.mediana != null && faixa.mediana > 0) {
    const desvio = (precoPrateleira - faixa.mediana) / faixa.mediana;
    if (Math.abs(desvio) < LIMIARES_VEREDITO.diferencaMinimaRelevante) return 'na_media';
    if (!temPercentis) return desvio < 0 ? 'barato' : 'caro';
  }

  if (precoPrateleira < faixa.p25!) return 'barato';
  if (precoPrateleira > faixa.p75!) return 'caro';
  return 'na_media';
}

/** `true` quando a base é pequena demais p/ confiar — UI sinaliza "poucos dados". */
export function poucosDados(faixa: FaixaPreco): boolean {
  return faixa.nObservacoes < LIMIARES_VEREDITO.minObservacoesConfiavel;
}

/** Um ângulo do veredito (regional ou pessoal) já resolvido. */
export interface AnguloVeredito {
  veredito: Veredito;
  faixa: FaixaPreco;
  /** Base pequena → exibir com ressalva. */
  poucosDados: boolean;
}

/** Linha de promoção exibida à parte (nunca no típico). */
export interface LinhaPromocao {
  /** Menor preço promocional visto entre os mundos disponíveis. */
  menorVisto: number;
  unidadeBase: UnidadeBase;
}

/** Entrada do veredito híbrido — qualquer um dos mundos pode faltar. */
export interface EntradaVeredito {
  precoPrateleira: number;
  /** Faixa da região (colaborativa/anônima). */
  regional?: FaixaPreco;
  /** Faixa do histórico do usuário (privada/local). */
  pessoal?: FaixaPreco;
}

/** Veredito híbrido — os dois ângulos lado a lado + a promoção à parte. */
export interface VeredictoHibrido {
  precoPrateleira: number;
  /** Veredito de destaque: regional quando há; senão cai para o pessoal. */
  veredito: Veredito;
  regional?: AnguloVeredito;
  pessoal?: AnguloVeredito;
  /** Presente só se houve menor promocional em algum dos mundos. */
  promocao?: LinhaPromocao;
}

function anguloDe(precoPrateleira: number, faixa: FaixaPreco): AnguloVeredito {
  return {
    veredito: classificarPreco(precoPrateleira, faixa),
    faixa,
    poucosDados: poucosDados(faixa),
  };
}

/** Menor `menorPromocional` definido entre as faixas (undefined se nenhum). */
function menorPromocional(...faixas: (FaixaPreco | undefined)[]): number | undefined {
  const valores = faixas
    .map((f) => f?.menorPromocional)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  return valores.length > 0 ? Math.min(...valores) : undefined;
}

/**
 * Monta o veredito híbrido. O destaque é o ângulo REGIONAL (o diferencial do
 * Barganha — vale mesmo para quem nunca comprou o item); o pessoal aparece ao
 * lado quando o usuário já tem histórico. A promoção fica numa linha separada.
 */
export function montarVeredito(entrada: EntradaVeredito): VeredictoHibrido {
  const regional = entrada.regional
    ? anguloDe(entrada.precoPrateleira, entrada.regional)
    : undefined;
  const pessoal = entrada.pessoal ? anguloDe(entrada.precoPrateleira, entrada.pessoal) : undefined;
  const destaque = regional ?? pessoal;

  const menor = menorPromocional(entrada.regional, entrada.pessoal);
  const unidadeBase = entrada.regional?.unidadeBase ?? entrada.pessoal?.unidadeBase;

  return {
    precoPrateleira: entrada.precoPrateleira,
    veredito: destaque?.veredito ?? 'sem_dados',
    ...(regional ? { regional } : {}),
    ...(pessoal ? { pessoal } : {}),
    ...(menor != null && unidadeBase ? { promocao: { menorVisto: menor, unidadeBase } } : {}),
  };
}
