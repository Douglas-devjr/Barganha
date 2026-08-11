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
import { foraDaJanela, idadeEmMeses, MAX_IDADE_TIPICO_DIAS, dadoRecente } from './frescor';
import { normalizarDescricao } from './normalizacao';

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
 * Limiares PADRÃO do veredito — **a calibrar com dados reais** (docs/06;
 * data-scientist). A zona morta tem ainda um recorte por categoria em
 * `ZONA_MORTA_POR_FAMILIA`; estes valores são a linha de base dela (e o que
 * vale sozinho quando o produto não tem categoria, o caso comum).
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
  /**
   * Deriva de preço presumida por MÊS de idade do típico — quanto a zona morta
   * cresce por mês de dado velho.
   *
   * Por que existir: a zona morta acima cerca o ruído da AMOSTRA, mas não o do
   * TEMPO. Um típico de três meses atrás descreve o mercado de três meses atrás;
   * comparar a gôndola de hoje contra ele com a mesma exigência de 5% é fingir
   * que preço de alimento não anda. Com deriva, quanto mais velho o típico, maior
   * a diferença necessária para o app cravar "barato" ou "caro" — ele fica mais
   * calado em vez de ficar errado.
   *
   * 0,8%/mês é conservador para alimento no Brasil: em 3 meses a zona morta vai de
   * 5% para ~7,4%; no limite da janela (6 meses), para ~9,8%. Não mata o veredito
   * em nenhum ponto da janela — só exige mais evidência conforme o dado envelhece.
   *
   * Este é o valor PADRÃO (família `outros`); por família, ver
   * `ZONA_MORTA_POR_FAMILIA`. A calibrar com dados reais (docs/06;
   * `backend job:calibracao` mede e recomenda, o humano aplica).
   */
  derivaMensalPresumida: 0.008,
} as const;

// ─────────────────────── Zona morta POR CATEGORIA (C3.6) ───────────────────

/**
 * Famílias de zona morta — o agrupamento de categorias por **comportamento de
 * preço**, não pela taxonomia do supermercado.
 *
 * Por que família e não a categoria crua: `produto_canonico.categoria` é texto
 * livre vindo do catálogo (`"Café"`, `"Hortifruti"`, `"Frutas"`, `"Bebidas"`…),
 * então uma tabela indexada pela categoria teria uma linha nova a cada rótulo
 * novo de fornecedor — e um valor calibrado sobre 4 observações de `"Frutas"`
 * não sabe nada sobre `"Hortifruti"`, que é o mesmo mercado. A família junta o
 * que se comporta igual e mantém a tabela pequena o bastante para ser calibrada.
 *
 *  • `fresco`          — vendido a peso ou feito na loja (hortifruti, açougue,
 *    peixaria, padaria): reprecificado toda semana, com safra e perda dentro.
 *  • `industrializado` — marca nacional, embalado, preço de tabela (mercearia,
 *    bebida, limpeza, higiene): anda devagar e quase junto entre as lojas.
 *  • `outros`          — categoria ausente ou desconhecida. É o caso COMUM hoje
 *    (categoria só existe para o produto já enriquecido pelo catálogo), então
 *    esta linha é o comportamento padrão do app — e por isso vale exatamente o
 *    valor global de antes: nada muda para quem não tem categoria.
 */
export const FAMILIAS_ZONA_MORTA = ['fresco', 'industrializado', 'outros'] as const;
export type FamiliaZonaMorta = (typeof FAMILIAS_ZONA_MORTA)[number];

/** Os dois números que definem a zona morta de uma família. */
export interface ParametrosZonaMorta {
  /** Diferença mínima relevante com o dado de HOJE (fração da mediana). */
  base: number;
  /** Quanto a zona morta cresce por MÊS de idade do típico (fração). */
  derivaMensal: number;
}

/**
 * Tabela por família — **chute fundamentado, ainda não calibração** (mesma
 * postura do resto do motor: `backend job:calibracao` mede sobre o pool real e
 * recomenda; trocar o número é decisão humana, em commit separado).
 *
 * O que varia entre famílias e o que NÃO varia:
 *
 *  • A **base NÃO varia** (5% em todas). Ela cerca irrelevância e percepção
 *    humana — "R$ 0,50 num item de R$ 10 não muda decisão" vale igual no tomate
 *    e no refrigerante. E subir a base no `fresco` seria pior que inútil: é
 *    justamente no produto disperso que a diferença entre lojas é sinal REAL
 *    (docs/06 — a 5% o filtro rebaixa ~79% dos "barato" no homogêneo e só ~1%
 *    no disperso), então uma base maior ali comeria exatamente o que o app
 *    existe para mostrar. Se a base tiver que subir no fresco, é por ruído de
 *    AMOSTRA (mediana de `n` pequeno balançando), e isso se mede — ver
 *    `calibrarZonaMorta` no backend.
 *
 *  • A **deriva VARIA**, e é aí que a categoria realmente importa. Ela cerca o
 *    ruído do TEMPO: quanto o preço andou desde que o típico foi observado.
 *    Alface e picanha são reprecificadas semanalmente, com safra e perda dentro
 *    do preço; um pacote de café não. 2%/mês contra 0,8%/mês é conservador e
 *    erra para o lado seguro — com típico velho de fresco o app fica mais calado
 *    em vez de cravar "caro" sobre o mercado de três meses atrás. Com dado de
 *    HOJE as duas famílias decidem idêntico, que é o caso da maioria das telas.
 */
export const ZONA_MORTA_POR_FAMILIA: Record<FamiliaZonaMorta, ParametrosZonaMorta> = {
  fresco: { base: LIMIARES_VEREDITO.diferencaMinimaRelevante, derivaMensal: 0.02 },
  industrializado: {
    base: LIMIARES_VEREDITO.diferencaMinimaRelevante,
    derivaMensal: LIMIARES_VEREDITO.derivaMensalPresumida,
  },
  outros: {
    base: LIMIARES_VEREDITO.diferencaMinimaRelevante,
    derivaMensal: LIMIARES_VEREDITO.derivaMensalPresumida,
  },
};

/**
 * Prefixos de TOKEN por família (a categoria é comparada palavra a palavra, não
 * por substring: `SABAO` não pode virar padaria por conter "pão" em pedaços).
 * Casa no singular e no plural de uma vez — `FRUT` pega FRUTA/FRUTAS.
 *
 * Prefixo curto demais é armadilha: `AVE` casaria AVEIA e AVELA, e cereal viraria
 * hortifruti. Onde o prefixo não separa, entra a palavra inteira (`AVES`).
 */
const PREFIXOS_FAMILIA: readonly (readonly [FamiliaZonaMorta, readonly string[]])[] = [
  [
    'fresco',
    [
      'HORTIFRUTI',
      'HORTIFRUTIGRANJEIRO',
      'FRUT',
      'LEGUME',
      'VERDURA',
      'FOLHOSO',
      'ACOUGUE',
      'CARNE',
      'BOVIN',
      'SUIN',
      'AVES',
      'FRANGO',
      'PEIXE',
      'PESCADO',
      'PEIXARIA',
      'PADARIA',
      'PAO',
      'PAES',
      'CONFEITARIA',
      'ROTISSERIA',
    ],
  ],
  [
    'industrializado',
    [
      'MERCEARIA',
      'BEBIDA',
      'REFRIGERANTE',
      'CERVEJA',
      'SUCO',
      'AGUA',
      'CAFE',
      'LATICINIO',
      'LEITE',
      'IOGURTE',
      'BISCOITO',
      'BOLACHA',
      'SNACK',
      'DOCE',
      'CHOCOLATE',
      'CEREAL',
      'MASSA',
      'ENLATADO',
      'CONSERVA',
      'CONGELADO',
      'LIMPEZA',
      'HIGIENE',
      'PERFUMARIA',
      'PET',
    ],
  ],
];

/**
 * Categoria (texto livre do catálogo) → família. Desconhecida ou ausente cai em
 * `outros`, que vale o padrão global — nunca inventa um comportamento novo para
 * um rótulo que ninguém mapeou.
 *
 * Vive em `shared/` pelo mesmo motivo de `MIN_OBSERVACOES_CONFIAVEL`: app
 * (offline) e backend precisam classificar IGUAL, senão o mesmo produto sai
 * "barato" num lado e "na média" no outro sem nada no log.
 */
export function familiaDeCategoria(categoria?: string): FamiliaZonaMorta {
  if (!categoria) return 'outros';
  const tokens = normalizarDescricao(categoria)
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return 'outros';
  for (const [familia, prefixos] of PREFIXOS_FAMILIA) {
    if (tokens.some((t) => prefixos.some((p) => t.startsWith(p)))) return familia;
  }
  return 'outros';
}

/** Parâmetros de zona morta da categoria (via família). */
export function parametrosZonaMorta(categoria?: string): ParametrosZonaMorta {
  return ZONA_MORTA_POR_FAMILIA[familiaDeCategoria(categoria)];
}

/**
 * Zona morta efetiva para esta faixa: a base da família ± o que a idade do dado
 * justifica (ver `ZONA_MORTA_POR_FAMILIA`).
 *
 * Idade DESCONHECIDA (`observadoEmMaisRecente` ausente — cache antigo, backend
 * anterior ao campo) é tratada como o limite do frescor, não como zero: uma
 * penalidade branda, porque supor o pior faria o app emudecer justamente durante
 * a transição em que nenhuma linha tem data ainda.
 */
export function zonaMortaPara(faixa: FaixaPreco, referencia: Date): number {
  const meses =
    idadeEmMeses(faixa.observadoEmMaisRecente, referencia) ?? MAX_IDADE_TIPICO_DIAS / 30.44;
  const { base, derivaMensal } = parametrosZonaMorta(faixa.categoria);
  return base + derivaMensal * Math.max(0, meses);
}

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
  /**
   * Categoria do produto (texto livre do catálogo) — só serve para escolher a
   * família da ZONA MORTA (`parametrosZonaMorta`). Ausente é o caso comum e
   * perfeitamente válido: cai na família `outros`, que vale o padrão global.
   */
  categoria?: string;
  /**
   * Quando esta faixa foi CALCULADA (ISO 8601). Não confundir com a idade do
   * preço: no ângulo REGIONAL isto é o carimbo do recálculo no servidor, e um
   * `recalcularTodos` (deploy, recalibração) põe "agora" em faixa sustentada por
   * cupom de meses atrás. Para idade do dado use `observadoEmMaisRecente`.
   */
  atualizadoEm: string;
  /**
   * Data da observação mais recente que sustenta a mediana (ISO 8601) — a idade
   * do PREÇO, comparável entre os dois ângulos.
   *
   * Existe porque `atualizadoEm` significava coisas diferentes em cada lado: na
   * faixa PESSOAL ele já era a data da última compra (idade real), na REGIONAL era
   * o recálculo do servidor. Quem exibisse "atualizado em" tratando os dois igual
   * afirmaria frescor que só um dos lados tinha.
   *
   * Ausente = idade DESCONHECIDA (cache anterior à coluna, backend antigo). Leia
   * como desconhecida, nunca como recente.
   */
  observadoEmMaisRecente?: string;
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
 * dela, o lado vem do sinal da própria diferença.
 *
 * A zona morta CRESCE com a idade do típico (`zonaMortaPara`): dado velho exige
 * diferença maior para merecer um rótulo. E passada a JANELA DA AGREGAÇÃO
 * (`foraDaJanela`) não há veredito nenhum — ali o próprio motor estatístico já
 * descartaria a observação, e o app não pode ser mais confiante que ele.
 *
 * Nunca compara contra `menorPromocional` (evita o falso "está caro" por causa
 * de uma promoção pontual antiga — docs/06).
 */
export function classificarPreco(
  precoPrateleira: number,
  faixa: FaixaPreco,
  /** "Agora" para medir a idade do típico (injetável p/ testes). */
  referencia: Date = new Date(),
): Veredito {
  if (!Number.isFinite(precoPrateleira) || precoPrateleira <= 0) return 'sem_dados';
  if (faixa.nObservacoes <= 0) return 'sem_dados';
  // Além da janela não é "dado velho", é dado que o motor já não usaria.
  if (foraDaJanela(faixa.observadoEmMaisRecente, referencia)) return 'sem_dados';

  const temPercentis = faixa.p25 != null && faixa.p75 != null;
  if (!temPercentis && faixa.mediana == null) return 'sem_dados';

  // Zona morta (só quando há mediana p/ medir a diferença contra).
  if (faixa.mediana != null && faixa.mediana > 0) {
    const desvio = (precoPrateleira - faixa.mediana) / faixa.mediana;
    if (Math.abs(desvio) < zonaMortaPara(faixa, referencia)) return 'na_media';
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
  /**
   * O típico passou da janela de frescor, OU a idade dele é desconhecida → exibir
   * com ressalva de "pode estar desatualizado".
   *
   * Cobre os dois casos com um flag só de propósito: para o usuário, "é de 60 dias
   * atrás" e "não sei de quando é" pedem a mesma cautela na gôndola. A idade exata,
   * quando existe, a tela mostra à parte.
   */
  dadoVelho: boolean;
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
  /** "Agora" para medir a idade dos típicos (injetável p/ testes). */
  referencia?: Date;
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

function anguloDe(precoPrateleira: number, faixa: FaixaPreco, referencia: Date): AnguloVeredito {
  return {
    veredito: classificarPreco(precoPrateleira, faixa, referencia),
    faixa,
    poucosDados: poucosDados(faixa),
    dadoVelho: !dadoRecente(faixa.observadoEmMaisRecente, referencia),
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
  // Uma referência para os dois ângulos: com `new Date()` em cada um, regional e
  // pessoal poderiam cair em lados opostos de um limiar de idade na mesma tela.
  const referencia = entrada.referencia ?? new Date();
  const regional = entrada.regional
    ? anguloDe(entrada.precoPrateleira, entrada.regional, referencia)
    : undefined;
  const pessoal = entrada.pessoal
    ? anguloDe(entrada.precoPrateleira, entrada.pessoal, referencia)
    : undefined;
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
