/**
 * C13.1 — Direitos por plano: a regra única que decide o que cada plano pode.
 * Vive em `shared/` porque app e backend precisam da MESMA resposta — quando o
 * C13.2/C13.3 chegarem, o servidor confere aqui o que o app já mostrou.
 *
 * O corte completo (grátis × Barganha+) está em `docs/21-assinatura-e-planos.md`.
 * Este arquivo é a versão executável dele.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS DUAS REGRAS TRAVADAS (docs/21) — leia antes de acrescentar qualquer coisa:
 *
 *   1. Nunca se cobra por nada que ALIMENTE O POOL. Escanear cupom é ilimitado
 *      no grátis, para sempre. Menos cupons = mediana pior = app pior inclusive
 *      para quem paga.
 *   2. Nunca se cobra pelo VEREDITO HONESTO. Faixa típica, mediana e o
 *      barato/na média/caro são idênticos nos dois planos. Pagar não compra uma
 *      verdade melhor, mais fresca ou mais precisa (é a decisão travada nº 8 —
 *      o muro da neutralidade — aplicada ao assinante).
 *
 * `NUNCA_COBRAVEL` abaixo transforma essas duas frases em código: um teste
 * garante que nada dessa lista vire recurso pago. Se um dia alguém tentar, o
 * build reprova — que é exatamente o ponto.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ESTADO: só a regra. Ninguém paga nada ainda — não há cobrança, não há Google
 * Play Billing (C13.3) e o plano ainda não vem do servidor (C13.2). Hoje todo
 * mundo nasce `gratis` e o plano mora no aparelho, alternável no interruptor de
 * teste das Configurações.
 */

/** Os planos. `plus_contribuindo` e `plus_pago` (C13.4) concedem o mesmo `plus`. */
export const PLANOS = ['gratis', 'plus'] as const;
export type Plano = (typeof PLANOS)[number];

/** Quem não tem plano conhecido é `gratis` — nunca o contrário. */
export const PLANO_PADRAO: Plano = 'gratis';

export function ePlano(valor: unknown): valor is Plano {
  return PLANOS.includes(valor as Plano);
}

/**
 * Capacidades que NUNCA podem virar recurso pago (regras 1 e 2 acima). Não é
 * documentação: `direitos.test.ts` cruza esta lista com `RECURSOS` e falha se
 * alguém mover um item de lado.
 */
export const NUNCA_COBRAVEL = [
  'escanear_cupom',
  'veredito',
  'faixa_tipica',
  'linha_de_promocao',
  'busca_no_pool',
  'catalogo_regional',
  'consulta_offline',
  'lista_de_compras',
  'excluir_conta',
] as const;
export type CapacidadeLivre = (typeof NUNCA_COBRAVEL)[number];

/* ── Recursos: corte de sim/não ───────────────────────────────────────────── */

/**
 * Recursos que existem inteiros no Barganha+ e não existem no grátis. Só entra
 * aqui o que é PROFUNDIDADE ou CONVENIÊNCIA — nunca o julgamento de preço.
 *
 * ATENÇÃO: hoje os quatro estão DECLARADOS e nenhuma tela os consulta — três
 * dependem de telas que ainda não existem (C8.3, C8.4.1, C12.4) e o de região
 * precisa que alguém guarde a data da última troca. Ficam aqui para a tela
 * nascer já perguntando ao lugar certo, mas declaração não é corte aplicado: o
 * mapa do que está de pé está em `docs/21` §"Linha a linha do corte".
 */
export const RECURSOS = [
  /** Gastos por categoria, por mercado e tendência (C8.3). */
  'estatisticas_detalhadas',
  /** A economia real item a item, e não só o número acumulado (C8.4.1). */
  'economia_detalhada',
  /** Baixar o histórico privado (CSV). */
  'exportar_historico',
  /** Trocar de região quando quiser (no grátis é uma troca a cada 30 dias). */
  'trocar_regiao_livre',
] as const;
export type Recurso = (typeof RECURSOS)[number];

/** Plano mínimo que libera cada recurso. Hoje todos exigem `plus`. */
const PLANO_MINIMO: Record<Recurso, Plano> = {
  estatisticas_detalhadas: 'plus',
  economia_detalhada: 'plus',
  exportar_historico: 'plus',
  trocar_regiao_livre: 'plus',
};

/** Ordem dos planos: o de cima inclui tudo do de baixo. */
const NIVEL: Record<Plano, number> = { gratis: 0, plus: 1 };

/**
 * A pergunta que toda tela faz. Passa pelo mapa acima — e não por um
 * `plano === 'plus'` solto — para que liberar um recurso isolado (promoção,
 * beta, resgate por contribuição) seja uma linha aqui, e não uma caçada por 25
 * telas.
 */
export function podeUsar(plano: Plano, recurso: Recurso): boolean {
  return NIVEL[plano] >= NIVEL[PLANO_MINIMO[recurso]];
}

/* ── Janelas de tempo: o grátis vê o recente, o plus vê tudo ──────────────── */

/** Meses de histórico privado visíveis no grátis. */
export const HISTORICO_GRATIS_MESES = 3;
/** Dias de evolução de preço no gráfico do produto, no grátis (C7.5). */
export const GRAFICO_GRATIS_DIAS = 30;

/**
 * Data a partir da qual o plano enxerga. `null` = sem corte (Barganha+).
 *
 * O corte é de EXIBIÇÃO, nunca de guarda: o cupom continua salvo, contando para
 * a economia acumulada e alimentando o pool. Assinar revela o que já é seu — não
 * ressuscita nada, porque nada foi apagado.
 */
export function inicioDoHistorico(plano: Plano, agora: Date): Date | null {
  if (plano === 'plus') return null;
  return subtrairMeses(agora, HISTORICO_GRATIS_MESES);
}

/**
 * Subtrai meses SEM o estouro do `setMonth`: 31 de julho − 3 meses é 30 de
 * abril, não 1º de maio. Sem o ajuste, quem abrisse o app num dia 31 veria a
 * janela do grátis encolher um dia — bug pequeno, mas do tipo que reaparece uma
 * vez por mês e ninguém consegue reproduzir.
 */
function subtrairMeses(base: Date, meses: number): Date {
  const d = new Date(base);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - meses);
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimoDia));
  return d;
}

/** Idem para o gráfico de evolução do produto. `null` = sem corte. */
export function inicioDoGrafico(plano: Plano, agora: Date): Date | null {
  if (plano === 'plus') return null;
  const corte = new Date(agora);
  corte.setDate(corte.getDate() - GRAFICO_GRATIS_DIAS);
  return corte;
}

/**
 * O registro cabe na janela do plano? Data ausente ou inválida → `true`: na
 * dúvida se MOSTRA. Esconder o que não se sabe datar transformaria um defeito de
 * dado em conteúdo pago, que é o pior erro possível aqui.
 */
export function dentroDoHistorico(
  quandoISO: string | undefined,
  plano: Plano,
  agora: Date,
): boolean {
  const corte = inicioDoHistorico(plano, agora);
  if (corte == null) return true;
  return depoisDe(quandoISO, corte);
}

/** Idem para o gráfico. Mesma leitura tolerante da data. */
export function dentroDoGrafico(quandoISO: string | undefined, plano: Plano, agora: Date): boolean {
  const corte = inicioDoGrafico(plano, agora);
  if (corte == null) return true;
  return depoisDe(quandoISO, corte);
}

function depoisDe(quandoISO: string | undefined, corte: Date): boolean {
  if (!quandoISO) return true;
  const ms = Date.parse(quandoISO);
  if (Number.isNaN(ms)) return true;
  return ms >= corte.getTime();
}

/* ── Contagens: o grátis tem um teto, o plus não tem ──────────────────────── */

/**
 * Tetos do plano grátis. Números baixos o suficiente para o limite ser sentido,
 * altos o suficiente para o recurso ser realmente experimentado — quem nunca
 * usou um alerta não assina para ter alertas ilimitados.
 */
export const LIMITES_GRATIS = {
  /** Produtos com alerta de preço ativo (C8.4). */
  alertas: 3,
  /** Mercados no ranking da cesta comparada (C12.1). */
  mercadosNaCesta: 3,
} as const;
export type Contagem = keyof typeof LIMITES_GRATIS;

/** Teto do plano para uma contagem. `Infinity` no Barganha+. */
export function limiteDe(plano: Plano, contagem: Contagem): number {
  return plano === 'plus' ? Infinity : LIMITES_GRATIS[contagem];
}

/** Ainda cabe mais um, tendo `jaUsados`? */
export function podeAdicionar(plano: Plano, contagem: Contagem, jaUsados: number): boolean {
  return jaUsados < limiteDe(plano, contagem);
}

/**
 * Corta uma lista no teto do plano. Devolve o que aparece e quantos ficaram de
 * fora — o número que a tela usa para dizer "+4 mercados no Barganha+". Recurso
 * bloqueado APARECE, não some (docs/21).
 */
export function aplicarTeto<T>(
  plano: Plano,
  contagem: Contagem,
  itens: readonly T[],
): { visiveis: T[]; ocultos: number } {
  const teto = limiteDe(plano, contagem);
  if (!Number.isFinite(teto)) return { visiveis: [...itens], ocultos: 0 };
  return {
    visiveis: itens.slice(0, teto),
    ocultos: Math.max(0, itens.length - teto),
  };
}

/* ── Revalidação do plano contra o servidor (C13.2/C13.5) ────────────────── */

/**
 * Dias sem conseguir confirmar o plano contra `GET /conta/estado` até o cache
 * local degradar pra grátis (docs/21 — "o plano precisa funcionar offline").
 * O corredor do mercado às vezes não tem sinal: sem esta folga, todo assinante
 * sem rede vira grátis no pior momento possível.
 */
export const FOLGA_REVALIDACAO_DIAS = 7;

/**
 * O cache local do plano ainda vale, mesmo sem conseguir falar com o servidor
 * agora? `null`/data ilegível conta como "nunca revalidado" → fora da folga.
 * A folga só ENCURTA um plano pago na ausência de rede, nunca ESTICA um plano
 * que o servidor já teria revogado — por isso ela nunca é usada pra CONCEDER
 * `plus`, só pra evitar derrubar um `plus` que já era real momentos atrás.
 */
export function dentroDaFolgaRevalidacao(revalidadoEmISO: string | null, agora: Date): boolean {
  if (!revalidadoEmISO) return false;
  const ms = Date.parse(revalidadoEmISO);
  if (Number.isNaN(ms)) return false;
  return agora.getTime() <= ms + FOLGA_REVALIDACAO_DIAS * 24 * 60 * 60 * 1000;
}
