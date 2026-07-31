/**
 * C12.1 — Comparação de lista de compras por loja ("onde a cesta sai mais
 * barata"). Feature de diferenciação inspirada no que mais engaja nos apps
 * estaduais (Preço da Hora BA, Menor Preço RS).
 *
 * Anônima como a consulta de preço: lê SÓ `preco_estatistica` (escopo `loja`)
 * + a referência pública da loja — nenhuma conta, nada do lado privado.
 *
 * Regras:
 *  • Base do preço é a MEDIANA da loja (decisão travada nº6 — nunca média);
 *    promoção aparece à parte (`menorPromocional`), sem entrar no total.
 *  • Cobertura manda no ranking: loja que tem MAIS itens da lista vem antes,
 *    mesmo mais cara — comparar totais de cestas diferentes engana. Empate de
 *    cobertura → menor total.
 *  • Filtro geográfico pela LOJA (chave normalizada de município, docs/06);
 *    sem município → UF; sem geo → todas (útil em dev/beta).
 *  • Piso de exposição por célula (loja × produto): abaixo de
 *    `MIN_OBSERVACOES_EXPOR_LOJA` o item não entra na cesta daquela loja
 *    (docs/04). Loja que fica sem nenhum item coberto some do ranking.
 *  • Cada loja volta com a EVIDÊNCIA do seu total: quantas observações o
 *    sustentam, a data do preço mais velho que entrou na conta e quantos itens
 *    têm promoção fora dela. Um total sozinho é um oráculo; com a evidência o
 *    usuário (e a UI) sabem quanto confiar — e é o que impede o selo de "mais
 *    barato" de sair para uma loja cujo preço é de meses atrás.
 */

import type {
  ComparacaoListaRequest,
  ComparacaoListaResponse,
  ItemComparacaoLoja,
  LojaComparacao,
} from '@barganha/shared';
import { chaveMunicipio, podeExporLoja } from '@barganha/shared';

import type { EstatisticaLojaLinha, FonteComparacaoLojas } from './tipos';

/** Teto de lojas na resposta — o app mostra um ranking, não um censo. */
const MAX_LOJAS = 10;

export class ServicoComparacaoLista {
  constructor(private readonly fonte: FonteComparacaoLojas) {}

  async comparar(req: ComparacaoListaRequest): Promise<ComparacaoListaResponse> {
    // Deduplica itens e fixa o multiplicador (padrão 1; inválido → 1).
    const quantidades = new Map<string, number>();
    for (const item of req.itens) {
      const q = item.quantidade != null && item.quantidade > 0 ? item.quantidade : 1;
      quantidades.set(item.produtoCanonicoId, q);
    }
    const produtoIds = [...quantidades.keys()];
    if (produtoIds.length === 0) return { itensTotal: 0, lojas: [] };

    const linhas = await this.fonte.estatisticasDeLojasPorProdutos(produtoIds);
    const noRecorte = linhas.filter((l) => this.dentroDoRecorte(l, req));

    // Agrupa por loja; para (loja, produto) repetido em mais de uma unidade-base
    // (raro), vence a linha com mais observações.
    const porLoja = new Map<string, Map<string, EstatisticaLojaLinha>>();
    for (const linha of noRecorte) {
      if (linha.mediana == null) continue;
      // Supressão de célula pequena (docs/04): aqui TUDO é escopo loja, então o
      // piso vale para cada célula (loja × produto). Com n=1 o preço exibido
      // seria literalmente a compra de uma pessoa naquela loja.
      if (!podeExporLoja(linha.nObservacoes)) continue;
      const itens = porLoja.get(linha.lojaCnpj) ?? new Map<string, EstatisticaLojaLinha>();
      const atual = itens.get(linha.produtoCanonicoId);
      if (!atual || linha.nObservacoes > atual.nObservacoes) {
        itens.set(linha.produtoCanonicoId, linha);
      }
      porLoja.set(linha.lojaCnpj, itens);
    }

    const lojas: LojaComparacao[] = [];
    for (const [cnpj, itensDaLoja] of porLoja) {
      // Linhas que de fato entraram no total — a base da evidência. Só elas:
      // item não coberto não tem preço somado, logo não tem idade nem peso aqui.
      const linhasCobertas: EstatisticaLojaLinha[] = [];
      const itens: ItemComparacaoLoja[] = produtoIds.map((id) => {
        const linha = itensDaLoja.get(id);
        if (!linha || linha.mediana == null) return { produtoCanonicoId: id };
        linhasCobertas.push(linha);
        const preco = arredondar(linha.mediana * (quantidades.get(id) ?? 1));
        return {
          produtoCanonicoId: id,
          preco,
          ...(linha.menorPromocional != null ? { menorPromocional: linha.menorPromocional } : {}),
        };
      });
      const cobertos = itens.filter((i) => i.preco != null);
      if (cobertos.length === 0) continue;
      const referencia = [...itensDaLoja.values()][0];
      lojas.push({
        lojaCnpj: cnpj,
        ...(referencia?.nomeLoja ? { nome: referencia.nomeLoja } : {}),
        ...(referencia?.municipioLoja ? { municipio: referencia.municipioLoja } : {}),
        total: arredondar(cobertos.reduce((soma, i) => soma + (i.preco ?? 0), 0)),
        itensCobertos: cobertos.length,
        itens,
        nObservacoes: linhasCobertas.reduce((soma, l) => soma + l.nObservacoes, 0),
        ...this.frescorDa(linhasCobertas),
        itensComPromocao: cobertos.filter((i) => i.menorPromocional != null).length,
      });
    }

    lojas.sort((a, b) => b.itensCobertos - a.itensCobertos || a.total - b.total);
    return { itensTotal: produtoIds.length, lojas: lojas.slice(0, MAX_LOJAS) };
  }

  /**
   * Data do preço mais VELHO entre os itens que entraram no total — o elo fraco
   * da conta. Se QUALQUER item coberto não tem data (linha anterior à coluna
   * `observado_em_max`), a resposta é a ausência: um "há 2 dias" calculado
   * ignorando o item sem data seria uma garantia que ninguém pode dar.
   */
  private frescorDa(linhas: readonly EstatisticaLojaLinha[]): { observadoEmMaisAntigo?: string } {
    let maisAntigo: string | undefined;
    let maisAntigoMs = Number.POSITIVE_INFINITY;
    for (const l of linhas) {
      if (!l.observadoEmMaisRecente) return {};
      // Comparação por INSTANTE, não por texto: o `timestamptz` do Postgres chega
      // como `...+00:00` e o do pipeline como `...Z` — ordenar essas duas formas
      // como string dá resultado errado.
      const ms = Date.parse(l.observadoEmMaisRecente);
      if (Number.isNaN(ms)) return {};
      if (ms < maisAntigoMs) {
        maisAntigoMs = ms;
        maisAntigo = l.observadoEmMaisRecente;
      }
    }
    return maisAntigo != null ? { observadoEmMaisAntigo: maisAntigo } : {};
  }

  /** Município (chave normalizada) quando informado; senão UF; senão tudo. */
  private dentroDoRecorte(linha: EstatisticaLojaLinha, req: ComparacaoListaRequest): boolean {
    if (req.municipio && req.uf) {
      if (!linha.municipioLoja || !linha.ufLoja) return false;
      return (
        chaveMunicipio(linha.ufLoja, linha.municipioLoja) === chaveMunicipio(req.uf, req.municipio)
      );
    }
    if (req.uf) return linha.ufLoja?.toUpperCase() === req.uf.toUpperCase();
    return true;
  }
}

/** Dinheiro com 2 casas — evita ruído de float na soma exibida. */
function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}
