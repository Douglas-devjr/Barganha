/**
 * C3.6.1 — FUSÃO de `produto_canonico` (curadoria).
 *
 * O buraco que isto fecha: o casamento por identidade exata nunca funde
 * produtos diferentes (bom), mas **fragmenta** o mesmo produto quando a loja
 * escreve a descrição de outro jeito ("CR LEITE X 200G" vs "CREME DE LEITE X
 * 200G") ou quando uma rede declara o EAN e outra não. Cada fragmento vira um
 * canônico com seu próprio pool raso — duas medianas de amostras partidas, o
 * produto duplicado na busca, e `n_observacoes` baixo em ambos.
 *
 * Até aqui a única saída documentada era "a curadoria resolve fundindo via
 * `produto_alias`" — e essa fusão **não existia**: `produto_alias` era gravado
 * e nunca lido, e nada reapontava observação nenhuma.
 *
 * O que a fusão faz, numa transação só (RPC `fundir_produto_canonico`):
 *  1. reaponta TUDO que referencia o perdedor → vencedor (pool, histórico
 *     privado, aliases, mapeamentos loja+código, alertas, denúncias);
 *  2. grava um `produto_alias` CONFIRMADO com a descrição do perdedor. Este
 *     passo é LOAD-BEARING, não decorativo: sem ele, o próximo cupom com a
 *     descrição antiga não acharia mais o canônico (foi apagado) e criaria o
 *     fragmento de novo — a fusão se desfaria sozinha na semana seguinte;
 *  3. apaga o perdedor (a estatística dele cai por cascata);
 *  4. recalcula a estatística do vencedor sobre o pool já unificado.
 *
 * O que ela NÃO faz, de propósito: adivinhar a direção. Fundir é destrutivo e
 * irreversível — as guardas abaixo recusam em vez de "corrigir" a intenção de
 * quem chamou.
 */

import type { UnidadeBase } from '@barganha/shared';

import { LancamentoInvalidoError } from '../erros';

/** Identificação mínima de um canônico para decidir se a fusão é legítima. */
export interface CanonicoParaFusao {
  id: string;
  unidadeBase: UnidadeBase;
  ean?: string;
  descricaoNormalizada?: string;
}

export interface ResumoFusao {
  perdedorId: string;
  vencedorId: string;
  observacoesRepontadas: number;
  itensRepontados: number;
  aliasesRepontados: number;
  codigosRepontados: number;
}

export interface RepositorioFusao {
  obterCanonicoParaFusao(produtoCanonicoId: string): Promise<CanonicoParaFusao | undefined>;
  /**
   * Reaponta tudo do perdedor para o vencedor e apaga o perdedor, ATOMICAMENTE.
   * Uma fusão pela metade (pool movido, histórico não) deixaria o banco num
   * estado que nenhuma tela sabe exibir — por isso é RPC, não uma sequência de
   * chamadas do backend.
   */
  fundirCanonicos(perdedorId: string, vencedorId: string): Promise<ResumoFusao>;
}

export class ServicoFusaoCanonicos {
  constructor(
    private readonly repo: RepositorioFusao,
    /** Recalcula o típico do vencedor sobre o pool já unificado. */
    private readonly recalcularProduto: (produtoCanonicoId: string) => Promise<unknown>,
  ) {}

  async fundir(perdedorId: string, vencedorId: string): Promise<ResumoFusao> {
    if (!perdedorId || !vencedorId) {
      throw new LancamentoInvalidoError('perdedorId e vencedorId são obrigatórios.');
    }
    if (perdedorId === vencedorId) {
      throw new LancamentoInvalidoError('perdedorId e vencedorId são o mesmo produto.');
    }

    const perdedor = await this.repo.obterCanonicoParaFusao(perdedorId);
    if (!perdedor) throw new LancamentoInvalidoError('Produto perdedor não encontrado.');
    const vencedor = await this.repo.obterCanonicoParaFusao(vencedorId);
    if (!vencedor) throw new LancamentoInvalidoError('Produto vencedor não encontrado.');

    // Guarda 1 — unidade-base. Fundir R$/kg com R$/un mistura duas escalas de
    // preço no mesmo pool: a mediana resultante não significa nada. É sempre
    // engano, nunca intenção.
    if (perdedor.unidadeBase !== vencedor.unidadeBase) {
      throw new LancamentoInvalidoError(
        `Unidades-base diferentes (${perdedor.unidadeBase} ≠ ${vencedor.unidadeBase}) — ` +
          'fundir misturaria escalas de preço incomparáveis.',
      );
    }

    // Guarda 2 — dois EANs reais e distintos são dois produtos distintos. O EAN
    // é a identidade mais forte que temos; fundir destruiria a do perdedor (o
    // índice único só deixa um sobreviver) e o erro seria invisível depois.
    if (perdedor.ean && vencedor.ean && perdedor.ean !== vencedor.ean) {
      throw new LancamentoInvalidoError(
        'Ambos têm EAN e são diferentes — são produtos distintos. ' +
          'Se um dos EANs estiver errado, corrija o cadastro antes de fundir.',
      );
    }

    // Guarda 3 — direção. Quem tem EAN é sempre o vencedor: manter o sem-EAN e
    // apagar o com-EAN jogaria fora a identidade forte. Recusa em vez de
    // inverter sozinho: fusão é destrutiva, e adivinhar a intenção de um
    // comando irreversível é pior que pedir para repetir.
    if (perdedor.ean && !vencedor.ean) {
      throw new LancamentoInvalidoError(
        'O perdedor tem EAN e o vencedor não — inverta a ordem para não perder o EAN.',
      );
    }

    const resumo = await this.repo.fundirCanonicos(perdedorId, vencedorId);
    // O pool do vencedor mudou de tamanho; sem recalcular, a faixa exibida
    // continua sendo a de antes da fusão (n menor, mediana de amostra partida).
    await this.recalcularProduto(vencedorId);
    return resumo;
  }
}
