/**
 * C3.4/C3.5 — ORDEM ÚNICA de resolução de um item de cupom → `produto_canonico`.
 *
 * Antes disto a ordem vivia espalhada dentro do `Anonimizador` (um `if (ean)
 * … else …`) e o `produto_alias` era **write-only**: a curadoria confirmava um
 * casamento e nada lia a linha. Aqui a ordem é explícita, testável e única —
 * a ingestão (C2), o backfill (`job:republicar`) e qualquer caminho futuro
 * passam pelo mesmo lugar.
 *
 *   0. EAN real          → identidade global; a mais forte que existe.
 *   1. (loja, código)    → SKU interno da loja; estável DENTRO da loja.
 *   2. alias confirmado  → decisão humana sobre um texto (C3.5).
 *   3. descrição exata   → acha-ou-cria; o último recurso.
 *
 * Por que 1 vem antes de 2 e 3, e o que o torna seguro: o mapeamento
 * (loja, código) é **cache de uma decisão tomada por um caminho igual ou mais
 * forte** — ele só nasce de 0, 2 ou 3, e **nunca cria** `produto_canonico`.
 * Sem esse invariante, a chave nova viraria uma porta lateral para casar por
 * similaridade sem confirmação, quebrando docs/06.
 *
 * Por que a chave existe (o ganho real): para item sem EAN, a identidade do
 * produto HOJE É a string exata. Qualquer mudança de escrita no PDV
 * (abreviação nova, "PROMO" no nome, troca de sistema) cria um canônico novo e
 * **parte a série de preço em duas, em silêncio** — a mediana volta a n=1 e o
 * veredito segue exibindo número com cara de confiança. A chave (loja, código)
 * sobrevive à deriva de descrição e mantém a série inteira. O ganho NÃO é
 * economia de CPU (o caminho 3 já é um SELECT indexado).
 */

import type { UnidadeBase } from '@barganha/shared';

import { similaridade } from '../estatistica/casamento-texto';
import type {
  CatalogoProdutos,
  FonteAliasTexto,
  MapaCodigoLoja,
  MapeamentoCodigoLoja,
  SugestaoProduto,
} from './casamento';

/**
 * Parâmetros das guardas da chave (loja, código).
 *
 * **A CALIBRAR com dados reais** (docs/06, responsável: data-scientist). São
 * chute fundamentado, não calibração: pontos de partida para medir quando o
 * pool do beta tiver volume. Os critérios de medição estão em docs/06.
 */
export const LIMIARES_CODIGO_LOJA = {
  /** Similaridade mínima com a descrição de referência p/ aceitar (status `ativo`). */
  aceita: 0.55,
  /**
   * Piso da faixa de DÚVIDA. Entre `duvida` e `aceita` o mapeamento não é
   * usado, mas a linha é marcada para a curadoria — é onde mora o reuso de
   * código (a loja descontinuou o item e reciclou o SKU).
   */
  duvida: 0.35,
  /**
   * Limiar ESTRITO, usado quando a evidência é mais fraca: mapeamento herdado
   * de outra filial da rede, ou linha `suspeito`/`dormente` tentando voltar.
   */
  estrita: 0.65,
  /**
   * Salto de preço (para mais ou para menos) que levanta suspeita. NUNCA veta
   * sozinho: promoção e inflação existem, e vetar por preço transformaria uma
   * liquidação legítima em "produto trocado".
   */
  fatorPreco: 3,
  /** Sem uso por este tanto de dias, a linha vira `dormente` (revalidação estrita). */
  diasDormencia: 548,
  /** Peso da observação nova na âncora de preço (EWMA lenta: uma promoção não a move). */
  pesoPrecoNovo: 0.25,
} as const;

/** Por qual caminho o item foi resolvido — vira métrica de cobertura. */
export type ViaResolucao =
  'ean' | 'codigo_loja' | 'codigo_rede' | 'alias' | 'descricao' | 'nenhuma';

/** Por que um mapeamento existente NÃO foi usado. */
export type MotivoRecusa =
  /** Unidade-base diferente: kg ≠ un é outro produto. Veto duro, custo zero. */
  | 'unidade_divergente'
  /** Descrição na faixa de dúvida + salto de preço: assinatura do reuso de SKU. */
  | 'reuso_provavel'
  /** Descrição na faixa de dúvida, preço coerente. */
  | 'descricao_divergente'
  /** Descrição sem nenhuma relação com a referência. */
  | 'descricao_incompativel';

export interface EntradaResolucao {
  /** Já normalizada (`normalizarDescricao`). */
  descricaoNormalizada: string;
  unidadeBase: UnidadeBase;
  /** CNPJ da loja emitente — parte da chave (o mesmo código significa coisas diferentes em redes diferentes). */
  lojaCnpj: string;
  ean?: string;
  /** Código interno da loja (SKU), quando o portal o expõe e não é um EAN. */
  codigoLoja?: string;
  /** R$/unidade-base já normalizado — só alimenta o SINAL de salto de preço. */
  precoNormalizado?: number;
}

export interface ResultadoResolucao {
  /** Ausente = nada casou; o item fica só no histórico privado. */
  produtoCanonicoId?: string;
  via: ViaResolucao;
  /** Preenchido quando um mapeamento existia mas foi recusado (vira fila de curadoria). */
  recusa?: MotivoRecusa;
  /** Mapeamento aceito, mas com preço fora da banda — sinal, não veto. */
  alertaPreco?: boolean;
}

export interface Avaliacao {
  aceito: boolean;
  similaridade: number;
  motivo?: MotivoRecusa;
  /** Preço fora da banda esperada. Informativo mesmo quando `aceito`. */
  saltoPreco: boolean;
}

/** Raiz do CNPJ (8 dígitos) — as filiais de uma rede a compartilham. */
export function raizCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '').slice(0, 8);
}

/** Dia (YYYY-MM-DD) de um instante — o pool nunca guarda hora (docs/04). */
export function diaDe(instante: Date): string {
  return instante.toISOString().slice(0, 10);
}

function diasEntre(deDia: string, ate: Date): number {
  const de = Date.parse(`${deDia}T00:00:00.000Z`);
  if (Number.isNaN(de)) return 0;
  return Math.floor((ate.getTime() - de) / 86_400_000);
}

/** Preço fora de [1/k, k] × âncora. Sem âncora ou sem preço → não há sinal. */
function precoSaltou(preco: number | undefined, ancora: number | undefined, k: number): boolean {
  if (preco === undefined || ancora === undefined || ancora <= 0 || preco <= 0) return false;
  const razao = preco / ancora;
  return razao > k || razao < 1 / k;
}

/**
 * Decide se um mapeamento existente ainda vale para o item que chegou.
 * Função PURA — é aqui que mora a estatística, e por isso é o que os testes
 * atacam de frente.
 *
 * Regras, em ordem:
 *  1. **Unidade-base divergente → veto duro.** kg ≠ un é outro produto, ponto.
 *  2. **Similaridade da descrição** contra a referência. O limiar é `aceita`
 *     para linha `ativo` e `estrita` para `suspeito`/`dormente` — evidência
 *     mais fraca exige prova mais forte, e é assim que uma linha marcada se
 *     recupera sozinha quando a descrição volta ao normal, sem intervenção.
 *  3. **Salto de preço** só qualifica a recusa (`reuso_provavel` em vez de
 *     `descricao_divergente`). Nunca veta sozinho.
 */
export function avaliarMapeamento(
  mapeamento: MapeamentoCodigoLoja,
  entrada: EntradaResolucao,
  opcoes: { agora?: Date; limiar?: number; limiares?: typeof LIMIARES_CODIGO_LOJA } = {},
): Avaliacao {
  const L = opcoes.limiares ?? LIMIARES_CODIGO_LOJA;
  const agora = opcoes.agora ?? new Date();
  const saltoPreco = precoSaltou(
    entrada.precoNormalizado,
    mapeamento.precoReferencia,
    L.fatorPreco,
  );

  if (mapeamento.unidadeBase !== entrada.unidadeBase) {
    return { aceito: false, similaridade: 0, motivo: 'unidade_divergente', saltoPreco };
  }

  const s = similaridade(entrada.descricaoNormalizada, mapeamento.descricaoReferencia);
  const dormente =
    mapeamento.status === 'dormente' || diasEntre(mapeamento.ultimoVisto, agora) > L.diasDormencia;
  const limiar =
    opcoes.limiar ?? (mapeamento.status === 'ativo' && !dormente ? L.aceita : L.estrita);

  if (s >= limiar) return { aceito: true, similaridade: s, saltoPreco };
  if (s >= L.duvida) {
    return {
      aceito: false,
      similaridade: s,
      motivo: saltoPreco ? 'reuso_provavel' : 'descricao_divergente',
      saltoPreco,
    };
  }
  return { aceito: false, similaridade: s, motivo: 'descricao_incompativel', saltoPreco };
}

/** Nova âncora de preço (EWMA lenta) a partir da anterior e da observação aceita. */
export function proximaAncoraPreco(
  anterior: number | undefined,
  observado: number | undefined,
  peso: number = LIMIARES_CODIGO_LOJA.pesoPrecoNovo,
): number | undefined {
  if (observado === undefined || observado <= 0) return anterior;
  if (anterior === undefined || anterior <= 0) return observado;
  return peso * observado + (1 - peso) * anterior;
}

export interface OpcoesResolvedor {
  /**
   * Herdar mapeamento de outra filial da mesma rede (raiz de CNPJ). Desligado
   * por padrão: é HIPÓTESE ("filiais compartilham o ERP"), não fato medido.
   * Ligue depois de conferir, no pool real, que o mesmo código concorda entre
   * filiais da mesma raiz (critério em docs/06).
   */
  alargarPorRede?: boolean;
  /** Injetável para teste determinístico da dormência. */
  agora?: () => Date;
}

/**
 * Orquestra a ordem de resolução. Sem estado; toda a persistência entra pelas
 * portas de `casamento.ts`, o que mantém o domínio testável sem banco.
 */
export class ResolvedorProduto {
  constructor(
    private readonly catalogo: CatalogoProdutos,
    private readonly fontes: {
      mapaCodigoLoja?: MapaCodigoLoja;
      aliasTexto?: FonteAliasTexto;
    } = {},
    private readonly opcoes: OpcoesResolvedor = {},
  ) {}

  async resolver(entrada: EntradaResolucao): Promise<ResultadoResolucao> {
    const sugestao: SugestaoProduto = {
      descricaoNormalizada: entrada.descricaoNormalizada,
      unidadeBase: entrada.unidadeBase,
    };

    // ── 0. EAN real ────────────────────────────────────────────────────
    if (entrada.ean) {
      const id = await this.catalogo.casarPorEan(entrada.ean, sugestao);
      // A loja declarou EAN *e* código: registra a ponte. É a origem mais
      // forte de mapeamento que existe, e é de graça (o dado já está aqui).
      await this.gravarMapeamento(entrada, id, 'ean');
      return { produtoCanonicoId: id, via: 'ean' };
    }

    // ── 1. (loja, código interno) ──────────────────────────────────────
    const porCodigo = await this.resolverPorCodigo(entrada);
    if (porCodigo.resolvido) return porCodigo.resolvido;
    // A recusa do passo 1 viaja como VALOR (não como estado da instância): o
    // resolvedor é único e serve cupons concorrentes — guardar isso em campo
    // faria a suspeita de um cupom vazar no resultado de outro.
    const recusa = porCodigo.recusa ? { recusa: porCodigo.recusa } : {};
    // Houve recusa ⇒ existe uma linha marcada `suspeito` esperando um humano.
    // Gravar o mapeamento agora a REESCREVERIA (upsert) com o canônico novo e
    // com status `ativo` — ou seja, o passo 3 desfaria em silêncio a decisão do
    // passo 1 de não confiar naquela linha, que é exatamente o "casar errado
    // sem ninguém ver" que a guarda existe para impedir. Enquanto a suspeita
    // não for resolvida, o item resolve pelos caminhos normais e o mapeamento
    // fica congelado como estava.
    const podeGravar = porCodigo.recusa === undefined;

    // ── 2. alias de texto CONFIRMADO pela curadoria ────────────────────
    if (entrada.descricaoNormalizada && this.fontes.aliasTexto) {
      const id = await this.fontes.aliasTexto.buscarAliasConfirmado(
        entrada.descricaoNormalizada,
        entrada.unidadeBase,
      );
      if (id) {
        if (podeGravar) await this.gravarMapeamento(entrada, id, 'humano');
        return { produtoCanonicoId: id, via: 'alias', ...recusa };
      }
    }

    // ── 3. descrição normalizada exata (acha-ou-cria) ──────────────────
    if (!entrada.descricaoNormalizada) return { via: 'nenhuma', ...recusa };
    const id = await this.catalogo.casarPorDescricao(sugestao);
    if (podeGravar) await this.gravarMapeamento(entrada, id, 'descricao_exata');
    return { produtoCanonicoId: id, via: 'descricao', ...recusa };
  }

  private async resolverPorCodigo(
    entrada: EntradaResolucao,
  ): Promise<{ resolvido?: ResultadoResolucao; recusa?: MotivoRecusa }> {
    const mapa = this.fontes.mapaCodigoLoja;
    if (!mapa || !entrada.codigoLoja) return {};
    const agora = this.opcoes.agora?.() ?? new Date();

    const daLoja = await mapa.buscarMapeamento(entrada.lojaCnpj, entrada.codigoLoja);
    if (daLoja) {
      const avaliacao = avaliarMapeamento(daLoja, entrada, { agora });
      if (avaliacao.aceito) {
        await mapa.registrarUsoMapeamento(entrada.lojaCnpj, entrada.codigoLoja, {
          descricaoReferencia: entrada.descricaoNormalizada || daLoja.descricaoReferencia,
          ...(proximaAncoraPreco(daLoja.precoReferencia, entrada.precoNormalizado) !== undefined
            ? {
                precoReferencia: proximaAncoraPreco(
                  daLoja.precoReferencia,
                  entrada.precoNormalizado,
                ) as number,
              }
            : {}),
        });
        return {
          resolvido: {
            produtoCanonicoId: daLoja.produtoCanonicoId,
            via: 'codigo_loja',
            ...(avaliacao.saltoPreco ? { alertaPreco: true } : {}),
          },
        };
      }
      // Recusado: NÃO reaponta o canônico sozinho — isso é exatamente o
      // "casar errado em silêncio" que a guarda existe para impedir. Marca a
      // linha, cai para o passo seguinte e deixa a decisão para o humano.
      await mapa.marcarMapeamentoSuspeito(
        entrada.lojaCnpj,
        entrada.codigoLoja,
        avaliacao.motivo ?? 'descricao_divergente',
      );
      return avaliacao.motivo ? { recusa: avaliacao.motivo } : {};
    }

    // 1b. Herança da rede (mesma raiz de CNPJ), atrás de flag e com limiar estrito.
    if (!this.opcoes.alargarPorRede) return {};
    const daRede = await mapa.buscarMapeamentoDaRede(
      raizCnpj(entrada.lojaCnpj),
      entrada.codigoLoja,
    );
    if (!daRede) return {};
    const avaliacao = avaliarMapeamento(daRede, entrada, {
      agora,
      limiar: LIMIARES_CODIGO_LOJA.estrita,
    });
    if (!avaliacao.aceito) {
      return avaliacao.motivo ? { recusa: avaliacao.motivo } : {};
    }
    // Materializa a linha da FILIAL: a próxima compra resolve direto, sem
    // depender de a hipótese de rede continuar valendo.
    await mapa.registrarMapeamento({
      lojaCnpj: entrada.lojaCnpj,
      codigo: entrada.codigoLoja,
      produtoCanonicoId: daRede.produtoCanonicoId,
      unidadeBase: entrada.unidadeBase,
      descricaoReferencia: entrada.descricaoNormalizada || daRede.descricaoReferencia,
      ...(entrada.precoNormalizado !== undefined
        ? { precoReferencia: entrada.precoNormalizado }
        : {}),
      origem: daRede.origem,
    });
    return {
      resolvido: {
        produtoCanonicoId: daRede.produtoCanonicoId,
        via: 'codigo_rede',
        ...(avaliacao.saltoPreco ? { alertaPreco: true } : {}),
      },
    };
  }

  /**
   * Grava o mapeamento (loja, código) depois de um caminho FORTE ter decidido.
   * É o único lugar que cria mapeamento — o passo 1 só lê. Nunca deixa a
   * ingestão falhar: perder o cache é irrelevante perto de perder o cupom.
   */
  private async gravarMapeamento(
    entrada: EntradaResolucao,
    produtoCanonicoId: string,
    origem: 'ean' | 'descricao_exata' | 'humano',
  ): Promise<void> {
    const mapa = this.fontes.mapaCodigoLoja;
    if (!mapa || !entrada.codigoLoja || !entrada.lojaCnpj) return;
    await mapa.registrarMapeamento({
      lojaCnpj: entrada.lojaCnpj,
      codigo: entrada.codigoLoja,
      produtoCanonicoId,
      unidadeBase: entrada.unidadeBase,
      descricaoReferencia: entrada.descricaoNormalizada,
      ...(entrada.precoNormalizado !== undefined
        ? { precoReferencia: entrada.precoNormalizado }
        : {}),
      origem,
      ...(entrada.ean ? { eanVisto: entrada.ean } : {}),
    });
  }
}
