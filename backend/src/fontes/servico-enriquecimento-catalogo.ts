/**
 * C11.5 automático — Enriquecimento de produto via catálogo público (VTEX).
 *
 * Para cada produto canônico com EAN e SEM `nome_exibicao`, consulta as redes
 * configuradas até uma conhecer o EAN e grava nome amigável, marca, categoria e
 * foto pelo MESMO gate da curadoria (`enriquecerProduto` — nunca toca
 * `descricao_normalizada`/EAN, a base do casamento).
 *
 * Polidez como política (mitigação de bloqueio/ToS):
 *  • lote pequeno por execução (`teto`) + PAUSA entre requisições;
 *  • circuit breaker por rede: falhas seguidas ⇒ a rede sai do resto do lote;
 *  • falha suave: um produto/rede com erro não derruba a execução;
 *  • cache natural: uma vez enriquecido, o produto sai da elegibilidade — cada
 *    EAN é consultado UMA vez na vida (não por usuário, não por consulta).
 */

import type { RepositorioCuradoria } from '../curadoria/tipos';

import type { FonteCatalogo, RedeVtex } from './vtex/tipos';

export interface OpcoesEnriquecimento {
  /** Máximo de produtos por execução (padrão 50 — educado p/ um cron diário). */
  teto?: number;
  /** Pausa entre requisições ao catálogo (padrão 1200 ms). */
  pausaMs?: number;
  /** Falhas seguidas que desligam uma rede no resto do lote (padrão 3). */
  maxFalhasPorRede?: number;
  /** Sleep injetável (testes determinísticos). */
  dormir?: (ms: number) => Promise<void>;
}

export interface ResumoEnriquecimento {
  examinados: number;
  enriquecidos: number;
  /** Nenhuma rede configurada conhecia o EAN. */
  semCatalogo: number;
  /** Requisições com erro (rede fora, HTTP != 200/206…). */
  falhas: number;
}

const pausaPadrao = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class ServicoEnriquecimentoCatalogo {
  private readonly teto: number;
  private readonly pausaMs: number;
  private readonly maxFalhas: number;
  private readonly dormir: (ms: number) => Promise<void>;

  constructor(
    private readonly repo: RepositorioCuradoria,
    private readonly fonte: FonteCatalogo,
    private readonly redes: RedeVtex[],
    opcoes: OpcoesEnriquecimento = {},
  ) {
    this.teto = opcoes.teto ?? 50;
    this.pausaMs = opcoes.pausaMs ?? 1200;
    this.maxFalhas = opcoes.maxFalhasPorRede ?? 3;
    this.dormir = opcoes.dormir ?? pausaPadrao;
  }

  async executar(): Promise<ResumoEnriquecimento> {
    const resumo: ResumoEnriquecimento = {
      examinados: 0,
      enriquecidos: 0,
      semCatalogo: 0,
      falhas: 0,
    };
    if (this.redes.length === 0) return resumo; // feature desligada (sem REDES_VTEX).

    const alvos = await this.repo.listarProdutosParaEnriquecer(this.teto);
    const falhasSeguidas = new Map<string, number>();

    for (const alvo of alvos) {
      resumo.examinados += 1;
      let achou = false;

      for (const rede of this.redes) {
        if ((falhasSeguidas.get(rede.id) ?? 0) >= this.maxFalhas) continue; // breaker aberto.
        try {
          const produto = await this.fonte.buscarPorEan(rede, alvo.ean);
          falhasSeguidas.set(rede.id, 0);
          if (produto) {
            await this.repo.enriquecerProduto({
              produtoCanonicoId: alvo.produtoCanonicoId,
              nomeExibicao: produto.nome,
              ...(produto.marca ? { marca: produto.marca } : {}),
              ...(produto.categoria ? { categoria: produto.categoria } : {}),
              ...(produto.imagemUrl ? { imagemUrl: produto.imagemUrl } : {}),
            });
            resumo.enriquecidos += 1;
            achou = true;
          }
        } catch {
          resumo.falhas += 1;
          falhasSeguidas.set(rede.id, (falhasSeguidas.get(rede.id) ?? 0) + 1);
        } finally {
          await this.dormir(this.pausaMs);
        }
        if (achou) break; // primeira rede que conhece o EAN resolve o produto.
      }

      if (!achou) resumo.semCatalogo += 1;
    }

    return resumo;
  }
}
