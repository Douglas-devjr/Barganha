/**
 * Adaptador de persistência EM MEMÓRIA — testes e dev local sem Supabase.
 * Implementa `RepositorioCupom` e `CatalogoProdutos`, espelhando a separação
 * privado/compartilhado em estruturas distintas. Expõe getters de inspeção
 * para os testes verificarem o que entrou em cada mundo.
 */

import { randomUUID } from 'node:crypto';

import {
  garantirSemDadoPessoal,
  type Loja,
  type ObservacaoAnonima,
  type PrecoEstatistica,
  type StatusCupom,
} from '@barganha/shared';

import type { ItemCupomNovo } from '../anonimizacao/anonimizador';
import type { CatalogoProdutos, SugestaoProduto } from '../anonimizacao/casamento';
import type { RepositorioUsuario } from '../auth/tipos';
import type { FonteProdutoConsulta } from '../consulta/tipos';
import {
  type CandidatoCanonico,
  type FonteCandidatosTexto,
  tokenizar,
} from '../estatistica/casamento-texto';
import type {
  FonteObservacoes,
  LinhaEstatistica,
  ObservacaoParaAgregacao,
  RepositorioEstatistica,
} from '../estatistica/tipos';
import type { FiltroDeltaSync, FonteDeltaSync } from '../sync/tipos';
import type {
  CupomComItens,
  CupomRegistro,
  DadosIngestao,
  DadosNotaProcessada,
  FiltroReprocessamento,
  RepositorioCupom,
  ResultadoIngestao,
} from './tipos';

interface CupomInterno extends CupomRegistro {
  lojaCnpj?: string;
  emitidoEm?: string;
  capturadoEm: string;
}

interface ItemCupomArmazenado extends ItemCupomNovo {
  id: string;
  cupomId: string;
}

interface ProdutoCanonicoInterno {
  id: string;
  ean: string;
  descricaoNormalizada: string;
  unidadeBase: string;
}

export class RepositorioMemoria
  implements
    RepositorioCupom,
    RepositorioUsuario,
    CatalogoProdutos,
    FonteProdutoConsulta,
    FonteObservacoes,
    RepositorioEstatistica,
    FonteDeltaSync,
    FonteCandidatosTexto
{
  // Lado PRIVADO.
  private readonly usuarios = new Set<string>();
  private readonly cupons = new Map<string, CupomInterno>();
  private readonly itensCupom: ItemCupomArmazenado[] = [];
  // Lado COMPARTILHADO (anônimo).
  private readonly lojas = new Map<string, Loja>();
  private readonly produtosPorEan = new Map<string, ProdutoCanonicoInterno>();
  // Pool com o instante de INSERÇÃO (criadoEm), separado da emissão (observadoEm),
  // para o sinal incremental do pipeline ser por inserção (F1).
  private readonly poolEntradas: { obs: ObservacaoAnonima; criadoEm: string }[] = [];
  private readonly estatisticas = new Map<string, PrecoEstatistica>();

  // ───────────────────────── RepositorioUsuario (C4.3) ────────────────

  criarAnonimo(): Promise<string> {
    const id = randomUUID();
    this.usuarios.add(id);
    return Promise.resolve(id);
  }

  existe(id: string): Promise<boolean> {
    return Promise.resolve(this.usuarios.has(id));
  }

  // ───────────────────────── RepositorioCupom ─────────────────────────

  criarOuObterPorChave(dados: DadosIngestao): Promise<ResultadoIngestao> {
    if (dados.chaveAcesso) {
      const existente = [...this.cupons.values()].find(
        (c) => c.usuarioId === dados.usuarioId && c.chaveAcesso === dados.chaveAcesso,
      );
      if (existente) {
        return Promise.resolve({ cupomId: existente.id, status: existente.status, novo: false });
      }
    }

    const id = randomUUID();
    this.cupons.set(id, {
      id,
      usuarioId: dados.usuarioId,
      chaveAcesso: dados.chaveAcesso,
      uf: dados.uf,
      qrPayload: dados.qrPayload,
      status: 'qr_capturado',
      capturadoEm: dados.capturadoEm,
    });
    return Promise.resolve({ cupomId: id, status: 'qr_capturado', novo: true });
  }

  obterParaProcessamento(cupomId: string): Promise<CupomRegistro | undefined> {
    const c = this.cupons.get(cupomId);
    if (!c) return Promise.resolve(undefined);
    return Promise.resolve({
      id: c.id,
      usuarioId: c.usuarioId,
      uf: c.uf,
      chaveAcesso: c.chaveAcesso,
      qrPayload: c.qrPayload,
      status: c.status,
    });
  }

  obterDoUsuario(cupomId: string, usuarioId: string): Promise<CupomComItens | undefined> {
    const c = this.cupons.get(cupomId);
    if (!c || c.usuarioId !== usuarioId) return Promise.resolve(undefined);
    const loja = c.lojaCnpj ? this.lojas.get(c.lojaCnpj) : undefined;
    return Promise.resolve({
      cupomId: c.id,
      status: c.status,
      ...(c.emitidoEm ? { emitidoEm: c.emitidoEm } : {}),
      ...(c.uf ? { uf: c.uf } : {}),
      ...(loja
        ? {
            loja: {
              cnpj: loja.cnpj,
              ...(loja.razaoSocial ? { razaoSocial: loja.razaoSocial } : {}),
              ...(loja.nomeFantasia ? { nomeFantasia: loja.nomeFantasia } : {}),
              ...(loja.municipio ? { municipio: loja.municipio } : {}),
              ...(loja.uf ? { uf: loja.uf } : {}),
            },
          }
        : {}),
      itens: this.itensCupom
        .filter((i) => i.cupomId === cupomId)
        .map((i) => ({
          ...(i.produtoCanonicoId ? { produtoCanonicoId: i.produtoCanonicoId } : {}),
          descricaoOriginal: i.descricaoOriginal,
          ...(i.ean ? { ean: i.ean } : {}),
          quantidade: i.quantidade,
          unidade: i.unidade,
          valorUnitario: i.valorUnitario,
          valorTotal: i.valorTotal,
          ...(i.desconto != null ? { desconto: i.desconto } : {}),
        })),
    });
  }

  marcarProcessado(cupomId: string, dados: DadosNotaProcessada): Promise<void> {
    const cupom = this.cupons.get(cupomId);
    if (!cupom) return Promise.reject(new Error(`Cupom ${cupomId} inexistente.`));

    this.upsertLoja(dados.loja);

    // Reprocessamento: substitui itens privados anteriores deste cupom.
    for (let i = this.itensCupom.length - 1; i >= 0; i--) {
      if (this.itensCupom[i]!.cupomId === cupomId) this.itensCupom.splice(i, 1);
    }
    for (const item of dados.itensPrivados) {
      this.itensCupom.push({ ...item, id: randomUUID(), cupomId });
    }

    // Pool anônimo é append-only (sem vínculo com o cupom — por isso o
    // reprocessamento só alveja cupons ainda não processados, C2.5). O guard
    // (C9.2) espelha a trava da escrita real antes de cada inserção.
    const agoraPool = new Date().toISOString();
    for (const obs of dados.observacoes) {
      this.poolEntradas.push({ obs: garantirSemDadoPessoal(obs), criadoEm: agoraPool });
    }

    cupom.status = 'processado';
    cupom.lojaCnpj = dados.loja.cnpj;
    cupom.emitidoEm = dados.emitidoEm;
    cupom.uf = dados.uf;
    return Promise.resolve();
  }

  marcarFalha(cupomId: string): Promise<void> {
    const cupom = this.cupons.get(cupomId);
    if (cupom) cupom.status = 'falha';
    return Promise.resolve();
  }

  listarParaReprocessar(filtro: FiltroReprocessamento): Promise<string[]> {
    const elegiveis = [...this.cupons.values()]
      .filter((c) => filtro.status.includes(c.status))
      .filter((c) => (filtro.uf ? c.uf === filtro.uf : true))
      .map((c) => c.id);
    return Promise.resolve(filtro.limite ? elegiveis.slice(0, filtro.limite) : elegiveis);
  }

  // ───────────────────────── CatalogoProdutos ─────────────────────────

  casarPorEan(ean: string, sugestao: SugestaoProduto): Promise<string> {
    const existente = this.produtosPorEan.get(ean);
    if (existente) return Promise.resolve(existente.id);

    const novo: ProdutoCanonicoInterno = {
      id: randomUUID(),
      ean,
      descricaoNormalizada: sugestao.descricaoNormalizada,
      unidadeBase: sugestao.unidadeBase,
    };
    this.produtosPorEan.set(ean, novo);
    return Promise.resolve(novo.id);
  }

  // ───────────────────────── FonteProdutoConsulta (C4.1) ──────────────

  obterProdutoPorEan(ean: string): Promise<string | undefined> {
    return Promise.resolve(this.produtosPorEan.get(ean)?.id);
  }

  // Pré-filtro pelo token mais longo do nome (espelha o ilike do Supabase); o
  // serviço ranqueia por similaridade entre os candidatos resultantes.
  candidatosPorNome(nome: string): Promise<CandidatoCanonico[]> {
    const token = tokenizar(nome).sort((a, b) => b.length - a.length)[0];
    if (!token) return Promise.resolve([]);
    const r = [...this.produtosPorEan.values()]
      .filter((p) => p.descricaoNormalizada.includes(token))
      .map((p) => ({ produtoCanonicoId: p.id, descricaoNormalizada: p.descricaoNormalizada }));
    return Promise.resolve(r);
  }

  // ───────────────────────── FonteObservacoes (C3) ────────────────────

  listarProdutosComObservacoes(desde?: string): Promise<string[]> {
    const ids = new Set<string>();
    for (const e of this.poolEntradas) {
      if (desde && e.criadoEm < desde) continue; // por inserção, não emissão (F1)
      ids.add(e.obs.produtoCanonicoId);
    }
    return Promise.resolve([...ids]);
  }

  observacoesDoProduto(produtoCanonicoId: string): Promise<ObservacaoParaAgregacao[]> {
    const r = this.poolEntradas
      .map((e) => e.obs)
      .filter((o) => o.produtoCanonicoId === produtoCanonicoId)
      .map((o) => ({
        produtoCanonicoId: o.produtoCanonicoId,
        unidadeBase: o.unidadeBase,
        lojaCnpj: o.lojaCnpj,
        ...(o.municipio ? { municipio: o.municipio } : {}),
        ...(o.uf ? { uf: o.uf } : {}),
        precoNormalizado: o.precoNormalizado,
        emPromocao: o.emPromocao,
        observadoEm: o.observadoEm,
      }));
    return Promise.resolve(r);
  }

  // ───────────────────────── RepositorioEstatistica (C3) ──────────────

  upsertEstatisticas(linhas: readonly LinhaEstatistica[]): Promise<void> {
    for (const l of linhas) {
      const chave = `${l.produtoCanonicoId}|${l.escopo}|${l.escopoId}|${l.unidadeBase}`;
      this.estatisticas.set(chave, {
        produtoCanonicoId: l.produtoCanonicoId,
        escopo: l.escopo,
        escopoId: l.escopoId,
        unidadeBase: l.unidadeBase,
        mediana: l.mediana,
        p25: l.p25,
        p75: l.p75,
        minimo: l.minimo,
        maximo: l.maximo,
        ...(l.menorPromocional != null ? { menorPromocional: l.menorPromocional } : {}),
        nObservacoes: l.nObservacoes,
        atualizadoEm: new Date().toISOString(),
      });
    }
    return Promise.resolve();
  }

  // O resolverFallback (C3.3) filtra por local; aqui devolvemos as linhas do
  // produto (o parâmetro `local` da porta é dispensável neste adaptador).
  candidatosFallback(produtoCanonicoId: string): Promise<PrecoEstatistica[]> {
    const r = [...this.estatisticas.values()].filter(
      (e) => e.produtoCanonicoId === produtoCanonicoId,
    );
    return Promise.resolve(r);
  }

  // ───────────────────────── FonteDeltaSync (C4.2) ────────────────────

  deltaEstatisticas(filtro: FiltroDeltaSync): Promise<PrecoEstatistica[]> {
    const escopos = filtro.escopoIds ? new Set(filtro.escopoIds) : undefined;
    const produtos = filtro.produtoCanonicoIds ? new Set(filtro.produtoCanonicoIds) : undefined;
    const r = [...this.estatisticas.values()]
      .filter((e) => (filtro.desde ? e.atualizadoEm > filtro.desde : true))
      .filter((e) => (escopos ? escopos.has(e.escopoId) : true))
      .filter((e) => (produtos ? produtos.has(e.produtoCanonicoId) : true))
      .sort((a, b) => a.atualizadoEm.localeCompare(b.atualizadoEm))
      .slice(0, filtro.limite);
    return Promise.resolve(r);
  }

  // ───────────────────────── FonteCandidatosTexto (C3.5) ──────────────

  listarCandidatos(unidadeBase: string): Promise<CandidatoCanonico[]> {
    const r = [...this.produtosPorEan.values()]
      .filter((p) => p.unidadeBase === unidadeBase)
      .map((p) => ({
        produtoCanonicoId: p.id,
        descricaoNormalizada: p.descricaoNormalizada,
      }));
    return Promise.resolve(r);
  }

  // ───────────────────────── Inspeção (testes) ────────────────────────

  estatisticasDoProduto(produtoCanonicoId: string): PrecoEstatistica[] {
    return [...this.estatisticas.values()].filter((e) => e.produtoCanonicoId === produtoCanonicoId);
  }

  observacoesDoPool(): readonly ObservacaoAnonima[] {
    return this.poolEntradas.map((e) => e.obs);
  }

  itensDoCupom(cupomId: string): ItemCupomArmazenado[] {
    return this.itensCupom.filter((i) => i.cupomId === cupomId);
  }

  statusDoCupom(cupomId: string): StatusCupom | undefined {
    return this.cupons.get(cupomId)?.status;
  }

  totalProdutos(): number {
    return this.produtosPorEan.size;
  }

  totalLojas(): number {
    return this.lojas.size;
  }

  private upsertLoja(loja: DadosNotaProcessada['loja']): void {
    this.lojas.set(loja.cnpj, {
      cnpj: loja.cnpj,
      razaoSocial: loja.razaoSocial,
      nomeFantasia: loja.nomeFantasia,
      endereco: loja.endereco,
      municipio: loja.municipio,
      uf: loja.uf,
    });
  }
}
