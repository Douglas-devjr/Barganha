/**
 * C4.4 — Busca no catálogo REGIONAL (o pool anônimo), a resposta ao cold start
 * (docs/20): quem acabou de criar a conta não tem catálogo local nenhum e, sem
 * isto, não consegue montar lista nem comparar mercados.
 *
 * Dois modos, o mesmo caminho:
 *   • com `termo`  → filtra por relevância de texto (ver `casaTermo`);
 *   • sem `termo`  → os POPULARES da região.
 * A ORDEM é a mesma nos dois: base de observações. Uma regra só de ordenação,
 * e neutra por construção — dinheiro não compra posição aqui (decisão travada
 * nº8) — e é também a mais útil: quem busca "arroz" quer primeiro o arroz que
 * mais se vê na região dele.
 *
 * Regras herdadas, não reinventadas:
 *   • o nível servido sai do `resolverFallback` (C3.3): município → região → UF,
 *     e o escopo efetivo volta na resposta para a UI poder rotular;
 *   • o escopo `loja` fica de fora (célula pequena, docs/04).
 *
 * Só lê o lado compartilhado: nenhuma conta, nenhum `usuario_id`.
 */

import type {
  BuscaProdutosRequest,
  BuscaProdutosResponse,
  EscopoGeo,
  PrecoEstatistica,
  ProdutoEncontrado,
} from '@barganha/shared';

import { LIMIARES_TEXTO, similaridade, tokenizar } from '../estatistica/casamento-texto';
import {
  derivarEscopos,
  type LocalGeo,
  MIN_OBSERVACOES_FALLBACK,
  resolverFallback,
  type ResolvedorRegiao,
} from '../estatistica/escopos';
import type { FonteBuscaProdutos, FonteProdutoConsulta } from './tipos';

/** Quantos produtos devolver quando o cliente não pede um número. */
export const LIMITE_BUSCA_PADRAO = 20;
/** Teto de servidor — pedido maior é cortado, não recusado. */
export const LIMITE_BUSCA_MAX = 50;

/**
 * Candidatos que um termo pode propor. Bem acima do `maxSugestoes` de 3 do
 * casamento de curadoria: ali a pergunta é "qual É este produto" (poucos e
 * bons); aqui é "o que existe com esse nome" — uma busca por "arroz" tem dezenas
 * de respostas legítimas.
 */
const MAX_CANDIDATOS_TERMO = 60;

/**
 * Relevância de BUSCA — de propósito diferente do casamento de identidade.
 * `sugerirCasamento` (C3.5) responde "estes dois textos são o mesmo produto?" e
 * por isso exige similaridade alta. Quem digita numa caixa de busca escreve
 * "arroz", não "ARROZ TIPO 1 5KG" — similaridade 0,38, reprovada lá e
 * obviamente certa aqui.
 *
 * Então a regra é a da busca: todo token digitado tem de PREFIXAR algum token da
 * descrição ("arroz int" acha "ARROZ INTEGRAL"), com a similaridade como rede
 * para erro de digitação ("arros").
 */
function casaTermo(termo: string, descricao: string): boolean {
  const tokens = tokenizar(termo);
  if (tokens.length === 0) return false;
  const daDescricao = tokenizar(descricao);
  const todosPrefixam = tokens.every((t) => daDescricao.some((d) => d.startsWith(t)));
  return todosPrefixam || similaridade(termo, descricao) >= LIMIARES_TEXTO.similaridadeMinima;
}

/**
 * Linhas lidas por produto pedido. Um produto rende até uma linha por escopo ×
 * unidade-base; folga suficiente para o fallback ter o que escolher sem trazer
 * a região inteira para a memória.
 */
const LINHAS_POR_PRODUTO = 4;

/** Teto absoluto de linhas lidas numa busca (proteção do banco). */
const MAX_LINHAS = 600;

export interface OpcoesBuscaProdutos {
  resolverRegiao?: ResolvedorRegiao;
  minObservacoes?: number;
}

interface Resolvido {
  produtoCanonicoId: string;
  escopoResolvido: EscopoGeo;
  estatistica: PrecoEstatistica;
}

export class ServicoBuscaProdutos {
  constructor(
    private readonly produtos: FonteProdutoConsulta,
    private readonly fonte: FonteBuscaProdutos,
    private readonly opcoes: OpcoesBuscaProdutos = {},
  ) {}

  async buscar(req: BuscaProdutosRequest): Promise<BuscaProdutosResponse> {
    const limite = Math.min(Math.max(req.limite ?? LIMITE_BUSCA_PADRAO, 1), LIMITE_BUSCA_MAX);
    const local: LocalGeo = {
      lojaCnpj: '',
      ...(req.municipio ? { municipio: req.municipio } : {}),
      ...(req.uf ? { uf: req.uf } : {}),
    };

    // Sem recorte geo não há "sua região" — devolver o Brasil inteiro seria pior
    // que devolver nada (o usuário compararia com preço de outro estado).
    const escopoIds = derivarEscopos(local, this.opcoes.resolverRegiao)
      .filter((e) => e.escopo !== 'loja')
      .map((e) => e.escopoId);
    if (escopoIds.length === 0) return { produtos: [] };

    const termo = req.termo?.trim();
    const candidatos = termo ? await this.candidatosDoTermo(termo) : undefined;
    // Termo que não casa com nada no catálogo: sem isto, cairíamos no modo
    // populares e devolveríamos uma lista que não tem relação com o que foi digitado.
    if (candidatos && candidatos.length === 0) return { produtos: [] };

    const linhas = await this.fonte.estatisticasNoEscopo({
      escopoIds,
      ...(candidatos ? { produtoCanonicoIds: candidatos } : {}),
      limite: Math.min((candidatos?.length ?? limite) * LINHAS_POR_PRODUTO, MAX_LINHAS),
    });

    // As linhas já chegam das mais observadas para as menos (contrato da fonte),
    // e agrupar preserva essa ordem — daí não haver um `sort` aqui.
    const escolhidos = this.resolverPorProduto(linhas, local).slice(0, limite);
    return { produtos: await this.anexarResumos(escolhidos) };
  }

  /**
   * Ids do catálogo relevantes para o termo. Quando há candidatos demais, ficam
   * os MAIS parecidos — o corte final por popularidade é do passo seguinte.
   */
  private async candidatosDoTermo(termo: string): Promise<string[]> {
    const candidatos = await this.produtos.candidatosPorNome(termo);
    return candidatos
      .filter((c) => casaTermo(termo, c.descricaoNormalizada))
      .map((c) => ({
        produtoCanonicoId: c.produtoCanonicoId,
        similaridade: similaridade(termo, c.descricaoNormalizada),
      }))
      .sort((a, b) => b.similaridade - a.similaridade)
      .slice(0, MAX_CANDIDATOS_TERMO)
      .map((c) => c.produtoCanonicoId);
  }

  /**
   * Uma linha por produto: a que o fallback geo escolheria na gôndola.
   *
   * A ordem de saída é a de PRIMEIRA aparição de cada produto nas linhas — que,
   * vindo ordenadas por base, é a do escopo em que ele mais aparece na região.
   * É de propósito: ranquear pela linha RESOLVIDA jogaria para cima todo produto
   * que caiu no fallback de UF (a UF sempre tem mais base que o município).
   */
  private resolverPorProduto(linhas: readonly PrecoEstatistica[], local: LocalGeo): Resolvido[] {
    const porProduto = new Map<string, PrecoEstatistica[]>();
    for (const linha of linhas) {
      const atual = porProduto.get(linha.produtoCanonicoId);
      if (atual) atual.push(linha);
      else porProduto.set(linha.produtoCanonicoId, [linha]);
    }

    const resolvidos: Resolvido[] = [];
    for (const [produtoCanonicoId, candidatas] of porProduto) {
      const r = resolverFallback(
        candidatas,
        local,
        this.opcoes.resolverRegiao,
        this.opcoes.minObservacoes ?? MIN_OBSERVACOES_FALLBACK,
      );
      if (!r) continue;
      resolvidos.push({
        produtoCanonicoId,
        escopoResolvido: r.escopoResolvido,
        estatistica: r.estatistica,
      });
    }
    return resolvidos;
  }

  /**
   * Anexa nome/marca/categoria (C11.5). Produto sem resumo é DESCARTADO: sem a
   * `unidadeBase` do resumo a UI não teria como escrever "R$ 8,90/kg", e uma
   * linha sem nome nem unidade não ajuda ninguém a montar lista.
   */
  private async anexarResumos(escolhidos: readonly Resolvido[]): Promise<ProdutoEncontrado[]> {
    if (escolhidos.length === 0) return [];
    const resumos = await this.fonte.resumosProdutos(escolhidos.map((e) => e.produtoCanonicoId));
    const porId = new Map(resumos.map((r) => [r.produtoCanonicoId, r]));
    return escolhidos.flatMap((e) => {
      const produto = porId.get(e.produtoCanonicoId);
      if (!produto) return [];
      return [{ produto, escopoResolvido: e.escopoResolvido, estatistica: e.estatistica }];
    });
  }
}
