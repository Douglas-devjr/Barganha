/**
 * C3/C7 — Normalização de preço para a unidade-base comparável (R$/kg, R$/L,
 * R$/un). Nunca se compara valor cru (decisão travada / docs/06).
 *
 * Mora em `shared/` de propósito: o MESMO mapa de unidades normaliza o preço no
 * backend (ao montar `observacao_preco`, C2.4) e no app (ao classificar o preço
 * de prateleira offline e ao montar a faixa pessoal, C7) — sem divergência.
 *
 * Usa o preço UNITÁRIO marcado na NFC-e (não o total/quantidade): o veredito
 * compara contra o preço regular de prateleira; a promoção é tratada à parte
 * via `emPromocao` (docs/06). Normalização por TAMANHO de pacote (ex.: R$/kg de
 * um "ARROZ 5KG" vendido por UN) é enriquecimento futuro (C11.5) — o que C3.4
 * resolve é a CONTAGEM de um multipack (quantas unidades vêm na caixa/fardo).
 */

import type { UnidadeBase } from '../core';

export interface PrecoNormalizado {
  unidadeBase: UnidadeBase;
  /** Preço já em R$/unidade_base. */
  precoNormalizado: number;
}

/** Conversão de uma unidade de venda para a base comparável. */
export interface FatorUnidade {
  base: UnidadeBase;
  /** Multiplica o preço unitário para chegar em R$/base. */
  fator: number;
}

/**
 * unidade da NFC-e → { base comparável, fator p/ converter o preço unitário }.
 * Só entram unidades de fator FIXO e inequívoco. Embalagem de contagem variável
 * (caixa, fardo, pack) não cabe aqui — o fator depende de quantas unidades vêm
 * dentro; ver `UNIDADES_EMBALAGEM_MULTIPLA`.
 */
export const MAPA_UNIDADES: Readonly<Record<string, FatorUnidade>> = {
  KG: { base: 'kg', fator: 1 },
  KGS: { base: 'kg', fator: 1 },
  KILO: { base: 'kg', fator: 1 },
  QUILO: { base: 'kg', fator: 1 },
  G: { base: 'kg', fator: 1000 },
  GR: { base: 'kg', fator: 1000 },
  GRS: { base: 'kg', fator: 1000 },
  GRAMA: { base: 'kg', fator: 1000 },
  GRAMAS: { base: 'kg', fator: 1000 },
  L: { base: 'L', fator: 1 },
  LT: { base: 'L', fator: 1 },
  LTS: { base: 'L', fator: 1 },
  LITRO: { base: 'L', fator: 1 },
  LITROS: { base: 'L', fator: 1 },
  ML: { base: 'L', fator: 1000 },
  UN: { base: 'un', fator: 1 },
  UND: { base: 'un', fator: 1 },
  UNID: { base: 'un', fator: 1 },
  UNIDADE: { base: 'un', fator: 1 },
  PC: { base: 'un', fator: 1 },
  PECA: { base: 'un', fator: 1 },
  DZ: { base: 'un', fator: 1 / 12 },
  DUZIA: { base: 'un', fator: 1 / 12 },
  // Embalagens vendidas como UMA peça (bandeja, envelope, frasco e pote vistos
  // em cupons reais do RJ; o resto é a mesma classe). Diferente de CX/FD (packs
  // com N unidades dentro), aqui 1 volume = 1 item vendido — racional do UN.
  BJ: { base: 'un', fator: 1 },
  BDJ: { base: 'un', fator: 1 },
  BANDEJA: { base: 'un', fator: 1 },
  EV: { base: 'un', fator: 1 },
  ENVELOPE: { base: 'un', fator: 1 },
  FR: { base: 'un', fator: 1 },
  FRASCO: { base: 'un', fator: 1 },
  PT: { base: 'un', fator: 1 },
  POTE: { base: 'un', fator: 1 },
  PCT: { base: 'un', fator: 1 },
  PCTE: { base: 'un', fator: 1 },
  PACOTE: { base: 'un', fator: 1 },
  PAC: { base: 'un', fator: 1 },
  SC: { base: 'un', fator: 1 },
  SACO: { base: 'un', fator: 1 },
  GF: { base: 'un', fator: 1 },
  GFA: { base: 'un', fator: 1 },
  GRF: { base: 'un', fator: 1 },
  GARRAFA: { base: 'un', fator: 1 },
  LATA: { base: 'un', fator: 1 },
  LTA: { base: 'un', fator: 1 },
  VD: { base: 'un', fator: 1 },
  VIDRO: { base: 'un', fator: 1 },
  TB: { base: 'un', fator: 1 },
  TUBO: { base: 'un', fator: 1 },
  RL: { base: 'un', fator: 1 },
  ROLO: { base: 'un', fator: 1 },
};

/**
 * Unidades de EMBALAGEM MÚLTIPLA: um volume com N itens dentro. Não têm fator
 * fixo — só normalizam quando a contagem é declarada, na própria unidade
 * ("CX12") ou na descrição ("CERVEJA 350ML CX 12"). O preço vai para R$/un do
 * item de dentro, que é o que compara com o mesmo produto vendido solto — o caso
 * comum dos portais SEM EAN (RJ/ENCAT), onde o casamento é pela descrição e
 * caixa e unidade caem no MESMO produto canônico.
 *
 * Sem contagem, o item continua fora do pool (era o comportamento de todas as
 * caixas antes de C3.4): melhor perder a observação que poluir a mediana com o
 * preço de um fardo disfarçado de unidade.
 *
 * KIT/CONJUNTO ficam de fora de propósito: o conteúdo é heterogêneo (shampoo +
 * condicionador), então dividir pela contagem não produz preço comparável.
 */
export const UNIDADES_EMBALAGEM_MULTIPLA: ReadonlySet<string> = new Set([
  'CX',
  'CXA',
  'CXS',
  'CAIXA',
  'CAIXAS',
  'FD',
  'FDO',
  'FRD',
  'FARDO',
  'FARDOS',
  'PACK',
  'PK',
  'PCK',
  'DP',
  'DISPLAY',
]);

/** Faixa sã de itens por embalagem — fora dela, o número lido não é contagem. */
const MIN_ITENS_EMBALAGEM = 2;
const MAX_ITENS_EMBALAGEM = 48;

/**
 * Como a contagem de um multipack aparece na descrição, do sinal mais forte para
 * o mais fraco. Todos leem a descrição já passada por `normalizarDescricao`.
 *
 * Os `\b` e o `(?!\d)` prendem a contagem ao número INTEIRO: sem eles o
 * retrocesso da regex leria o "2" de "20X30CM" e diria "caixa de 2".
 */
const PADROES_ITENS_EMBALAGEM: readonly RegExp[] = [
  // "12X350ML", "6 X 1,5 L" — "N × tamanho" só existe em multipack.
  /\b(\d{1,3})\s*[X*]\s*\d+(?:[.,]\d+)?\s*(?:ML|LT|L|KG|GR|G|UN)\b/,
  // "CX 12 UNIDADES", "OVOS 30UN".
  /\b(\d{1,3})\s*UN(?:ID(?:ADES?)?)?\b/,
  // "CX 12", "FARDO 6", "C/12". Recusa quando o número é TAMANHO ("CX 5KG") ou
  // abre um "N × tamanho" (esse é do primeiro padrão, mais confiável).
  /\b(?:CX|CAIXA|FD|FARDO|PACK|PCT|PACOTE|EMB|DP|DISPLAY|C\/|COM)\s*(\d{1,3})(?!\d)(?!\s*[X*]\s*\d)(?!\s*(?:KG|GR|G|ML|LT|L)\b)/,
];

/**
 * Quantos itens vêm na embalagem, segundo a descrição — `undefined` quando ela
 * não declara. Só é consultada para unidade de embalagem múltipla: para as
 * demais o fator é fixo, então a descrição NUNCA muda um preço já normalizável
 * (no máximo destrava um que estava fora). É essa assimetria que garante que app
 * e backend não divirjam se um deles esquecer de passar a descrição.
 */
export function itensPorEmbalagem(descricao: string): number | undefined {
  const texto = normalizarDescricao(descricao);
  for (const padrao of PADROES_ITENS_EMBALAGEM) {
    const achado = padrao.exec(texto)?.[1];
    const n = achado != null ? Number(achado) : Number.NaN;
    if (Number.isInteger(n) && n >= MIN_ITENS_EMBALAGEM && n <= MAX_ITENS_EMBALAGEM) return n;
  }
  return undefined;
}

/**
 * Unidade crua da NFC-e → chave do mapa: sem acento, caixa alta, só letras e
 * números ("un." → UN, "PÇ" → PC, "Cx 12" → CX12). Os portais são inconsistentes
 * na pontuação e no acento; a chave absorve isso.
 */
function chaveUnidade(unidade: string): string {
  return unidade
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Separa a contagem colada na unidade: "CX12" → { prefixo: 'CX', itens: 12 }. */
function separarContagem(chave: string): { prefixo: string; itens?: number } {
  const partes = /^([A-Z]+)(\d{1,3})$/.exec(chave);
  if (!partes) return { prefixo: chave };
  const itens = Number(partes[2]);
  if (itens < MIN_ITENS_EMBALAGEM || itens > MAX_ITENS_EMBALAGEM) return { prefixo: chave };
  return { prefixo: partes[1]!, itens };
}

/**
 * Unidade de venda (+ descrição, quando houver) → { base, fator }. `undefined`
 * quando a unidade é desconhecida ou é embalagem múltipla sem contagem — nos dois
 * casos o item fica fora do pool.
 */
export function resolverUnidade(unidade: string, descricao?: string): FatorUnidade | undefined {
  const chave = chaveUnidade(unidade);
  if (!chave) return undefined;

  const direta = MAPA_UNIDADES[chave];
  if (direta) return direta;

  // Chegou aqui: ou é embalagem múltipla ("CX", "FD 6"), ou é unidade conhecida
  // com a contagem colada ("PCT12" = pacote de 12), ou é desconhecida mesmo.
  const { prefixo, itens } = separarContagem(chave);
  const doPrefixo = MAPA_UNIDADES[prefixo];
  const eEmbalagem = UNIDADES_EMBALAGEM_MULTIPLA.has(prefixo);
  if (!eEmbalagem && !(itens != null && doPrefixo?.base === 'un' && doPrefixo.fator === 1)) {
    return undefined;
  }

  const dentro = itens ?? (descricao != null ? itensPorEmbalagem(descricao) : undefined);
  if (dentro == null) return undefined;
  return { base: 'un', fator: 1 / dentro };
}

/** Arredonda para 4 casas (evita ruído de ponto flutuante no R$/base). */
function arredondar(valor: number): number {
  return Math.round(valor * 1e4) / 1e4;
}

/**
 * Converte o preço unitário de um item para a unidade-base. Retorna `undefined`
 * quando a unidade é desconhecida ou o preço é inválido — nesse caso o item NÃO
 * entra no pool compartilhado (fica só no histórico privado) e a UI o ignora no
 * veredito.
 *
 * `descricao` é opcional e serve a UM propósito: ler a contagem de um multipack
 * (C3.4). Passe-a sempre que existir — sem ela, caixa e fardo continuam fora do
 * pool. Omiti-la nunca produz um preço DIFERENTE, só um preço a menos.
 */
export function normalizarPreco(item: {
  unidade: string;
  valorUnitario: number;
  descricao?: string;
}): PrecoNormalizado | undefined {
  const mapeado = resolverUnidade(item.unidade, item.descricao);
  if (!mapeado) return undefined;
  if (!Number.isFinite(item.valorUnitario) || item.valorUnitario <= 0) return undefined;

  return {
    unidadeBase: mapeado.base,
    precoNormalizado: arredondar(item.valorUnitario * mapeado.fator),
  };
}

/**
 * Preço unitário EFETIVO de um item de cupom: quando a NFC-e traz desconto no
 * próprio item, o que o consumidor pagou por unidade é
 * `valorUnitario − desconto/quantidade` (o `vDesc` da NFC-e é o desconto TOTAL
 * do item; o unitário impresso é sempre o cheio). É este o preço que vale como
 * observação — publicar o unitário cheio de um item em promoção faria o
 * "menor promocional" (docs/06) reportar um preço que ninguém pagou.
 *
 * Independe da convenção de exibição do "valor total" do portal (bruto ou
 * líquido), por derivar só de unitário/desconto/quantidade. Sem desconto (ou
 * com dados inválidos), devolve o próprio `valorUnitario`. Um resultado ≤ 0
 * (desconto maior que o item — dado quebrado) é rejeitado adiante pelo
 * `normalizarPreco`, ficando fora do pool.
 */
export function precoUnitarioEfetivo(item: {
  valorUnitario: number;
  quantidade: number;
  desconto?: number;
}): number {
  if (item.desconto == null || item.desconto <= 0 || !(item.quantidade > 0)) {
    return item.valorUnitario;
  }
  return item.valorUnitario - item.desconto / item.quantidade;
}

/**
 * Unidade de venda canônica de uma unidade-base (R$/kg → "KG", etc.). Útil na
 * gôndola (C7): quando o usuário digita o preço de prateleira de um produto
 * cuja base é conhecida mas sem unidade explícita, assume-se a venda na própria
 * base (fator 1) — ex.: pacote vendido por UN, carne por KG.
 */
export function unidadePadraoDaBase(base: UnidadeBase): string {
  switch (base) {
    case 'kg':
      return 'KG';
    case 'L':
      return 'L';
    case 'un':
      return 'UN';
  }
}

/** Normaliza descrição p/ casamento/canônico: sem acento, maiúsculas, 1 espaço. */
export function normalizarDescricao(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chave canônica de um município (`UF:MUNICIPIO`) — o `escopo_id` do nível
 * `municipio` em `preco_estatistica`. FONTE ÚNICA usada na ESCRITA (pipeline, ao
 * derivar escopos) e na LEITURA (consulta/sync do app): o município nasce cru do
 * endereço da nota (o parser gera `"SAO PAULO"`, caixa alta sem acento) e um
 * seletor de cidade produz `"São Paulo"` — normalizar os dois lados pelo mesmo
 * `normalizarDescricao` garante que casem. `''` quando falta UF ou município.
 */
export function chaveMunicipio(uf: string, municipio: string): string {
  const u = uf.trim().toUpperCase();
  const m = normalizarDescricao(municipio);
  return u && m ? `${u}:${m}` : '';
}
