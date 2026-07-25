/**
 * Adaptador de persistência EM MEMÓRIA — testes e dev local sem Supabase.
 * Implementa `RepositorioCupom` e `CatalogoProdutos`, espelhando a separação
 * privado/compartilhado em estruturas distintas. Expõe getters de inspeção
 * para os testes verificarem o que entrou em cada mundo.
 */

import { randomUUID } from 'node:crypto';

import {
  type DenunciaCuradoria,
  garantirSemDadoPessoal,
  type Loja,
  type MotivoDenuncia,
  type ObservacaoAnonima,
  type PrecoEstatistica,
  type ProdutoResumo,
  type StatusCupom,
  type StatusModeracao,
  type TotaisNota,
  type UnidadeBase,
} from '@barganha/shared';

import type { ItemCupomNovo } from '../anonimizacao/anonimizador';
import type { CatalogoProdutos, SugestaoProduto } from '../anonimizacao/casamento';
import type { RepositorioUsuario } from '../auth/tipos';
import type {
  EstatisticaLojaLinha,
  FiltroBuscaProdutos,
  FonteBuscaProdutos,
  FonteComparacaoLojas,
  FonteProdutoConsulta,
} from '../consulta/tipos';
import type {
  AlvoEnriquecimento,
  EnriquecimentoProduto,
  RepositorioCuradoria,
} from '../curadoria/tipos';
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
import type {
  LancamentoModeracaoNovo,
  LancamentoModeracaoRegistro,
  LojaModeracao,
  RepositorioModeracao,
} from '../moderacao/tipos';
import type {
  DenunciaNova,
  DenunciaRegistrada,
  RepositorioDenuncia,
} from '../moderacao/tipos-denuncia';
import type { FiltroDeltaSync, FonteDeltaSync, LinhaDelta } from '../sync/tipos';
import type {
  CupomComItens,
  CupomRegistro,
  DadosIngestao,
  DadosNotaProcessada,
  FiltroReprocessamento,
  RepositorioCupom,
  ResultadoIngestao,
  ResultadoMarcarProcessado,
} from './tipos';

interface CupomInterno extends CupomRegistro {
  lojaCnpj?: string;
  emitidoEm?: string;
  capturadoEm: string;
  descontoTotal?: number;
  valorPago?: number;
  falhaMotivo?: string;
}

interface ItemCupomArmazenado extends ItemCupomNovo {
  id: string;
  cupomId: string;
}

/** Denúncia guardada em memória (espelha `denuncia_preco`). C12.5. */
interface DenunciaInterna {
  id: string;
  /** PRIVADO — anti-abuso. Nunca sai na visão de curadoria. */
  usuarioId: string;
  produtoCanonicoId: string;
  motivo: MotivoDenuncia;
  municipio?: string;
  uf?: string;
  comentario?: string;
  status: StatusModeracao;
  criadoEm: string;
  decididoEm?: string;
  resolucao?: string;
}

interface ProdutoCanonicoInterno {
  id: string;
  /** Ausente nos canônicos casados por descrição (portal sem EAN). */
  ean?: string;
  descricaoNormalizada: string;
  unidadeBase: UnidadeBase;
  // Enriquecimento de curadoria (C11.5) — só exibição, não afeta o casamento.
  nomeExibicao?: string;
  marca?: string;
  categoria?: string;
  imagemUrl?: string;
}

/** Resumo de exibição (C11.5) de um canônico — a forma que a UI consome. */
function resumoDe(p: ProdutoCanonicoInterno): ProdutoResumo {
  return {
    produtoCanonicoId: p.id,
    ...(p.nomeExibicao ? { nomeExibicao: p.nomeExibicao } : {}),
    ...(p.marca ? { marca: p.marca } : {}),
    ...(p.categoria ? { categoria: p.categoria } : {}),
    ...(p.imagemUrl ? { imagemUrl: p.imagemUrl } : {}),
    unidadeBase: p.unidadeBase,
  };
}

/** Lançamento manual armazenado (PRIVADO — tem o autor). C11.3. */
interface LancamentoModeracaoInterno extends LancamentoModeracaoNovo {
  id: string;
  status: StatusModeracao;
  motivo?: string;
  criadoEm: string;
  decididoEm?: string;
}

export class RepositorioMemoria
  implements
    RepositorioCupom,
    RepositorioUsuario,
    CatalogoProdutos,
    FonteProdutoConsulta,
    FonteBuscaProdutos,
    FonteComparacaoLojas,
    FonteObservacoes,
    RepositorioEstatistica,
    FonteDeltaSync,
    FonteCandidatosTexto,
    RepositorioModeracao,
    RepositorioDenuncia,
    RepositorioCuradoria
{
  // Lado PRIVADO.
  private readonly usuarios = new Set<string>();
  private readonly cupons = new Map<string, CupomInterno>();
  private readonly itensCupom: ItemCupomArmazenado[] = [];
  // Moderação de lançamento manual (PRIVADO — tem usuario_id). C11.3.
  private readonly lancamentos = new Map<string, LancamentoModeracaoInterno>();
  // Denúncias de preço (PRIVADO — tem usuario_id). C12.5.
  private readonly denuncias = new Map<string, DenunciaInterna>();
  // Lado COMPARTILHADO (anônimo).
  private readonly lojas = new Map<string, Loja>();
  private readonly produtosPorEan = new Map<string, ProdutoCanonicoInterno>();
  // Canônicos sem EAN, chaveados por `descricao|unidade` (espelha o índice único parcial).
  private readonly produtosPorDescricao = new Map<string, ProdutoCanonicoInterno>();
  // Pool com o instante de INSERÇÃO (criadoEm), separado da emissão (observadoEm),
  // para o sinal incremental do pipeline ser por inserção (F1).
  private readonly poolEntradas: { obs: ObservacaoAnonima; criadoEm: string }[] = [];
  /** C9.2.1 — hashes de chave já publicados no pool (espelha `chave_publicada`). */
  private readonly chavesPublicadas = new Set<string>();
  private readonly estatisticas = new Map<string, PrecoEstatistica>();
  /** Desempate do cursor keyset (espelha `preco_estatistica.seq`). */
  private readonly seqEstatistica = new Map<string, number>();
  private proximoSeq = 1;

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
      ...(c.descontoTotal != null ? { descontoTotal: c.descontoTotal } : {}),
      ...(c.valorPago != null ? { valorPago: c.valorPago } : {}),
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

  apagarDoUsuario(cupomId: string, usuarioId: string): Promise<boolean> {
    const c = this.cupons.get(cupomId);
    if (!c || c.usuarioId !== usuarioId) return Promise.resolve(false);
    this.cupons.delete(cupomId);
    // Espelha o `on delete cascade` do banco real (array é readonly: splice).
    for (let i = this.itensCupom.length - 1; i >= 0; i--) {
      if (this.itensCupom[i]!.cupomId === cupomId) this.itensCupom.splice(i, 1);
    }
    return Promise.resolve(true);
  }

  atualizarTotais(cupomId: string, total: TotaisNota): Promise<void> {
    const cupom = this.cupons.get(cupomId);
    // Mesmas guardas do adaptador real: só processado e ainda sem totais.
    if (cupom && cupom.status === 'processado' && cupom.valorPago == null) {
      cupom.descontoTotal = total.desconto;
      cupom.valorPago = total.pago;
    }
    return Promise.resolve();
  }

  marcarProcessado(
    cupomId: string,
    dados: DadosNotaProcessada,
    opcoes?: { sobrescreverProcessado?: boolean },
  ): Promise<ResultadoMarcarProcessado> {
    const cupom = this.cupons.get(cupomId);
    if (!cupom) return Promise.reject(new Error(`Cupom ${cupomId} inexistente.`));
    // Espelha a trava da RPC `processar_cupom` (FOR UPDATE + status): dois
    // processadores em corrida (fila × ingestão por HTML) — o segundo vira
    // no-op em vez de duplicar o pool (append-only, indedupável a posteriori).
    // O backfill (job:republicar) é a exceção deliberada (ver tipos.ts).
    if (cupom.status === 'processado' && !opcoes?.sobrescreverProcessado) {
      return Promise.resolve({ poolPublicado: false });
    }

    this.upsertLoja(dados.loja);

    // Reprocessamento: substitui itens privados anteriores deste cupom.
    for (let i = this.itensCupom.length - 1; i >= 0; i--) {
      if (this.itensCupom[i]!.cupomId === cupomId) this.itensCupom.splice(i, 1);
    }
    for (const item of dados.itensPrivados) {
      this.itensCupom.push({ ...item, id: randomUUID(), cupomId });
    }

    // C9.2.1 — dedup GLOBAL do pool: a chave publica uma vez, seja qual for a
    // conta. Só reivindica o hash quando HÁ observações (um cupom sem casamento
    // não "queima" a chave — o job:republicar publica depois).
    let poolPublicado = true;
    if (dados.chaveHash && dados.observacoes.length > 0) {
      if (this.chavesPublicadas.has(dados.chaveHash)) {
        poolPublicado = false;
      } else {
        this.chavesPublicadas.add(dados.chaveHash);
      }
    }

    // Pool anônimo é append-only (sem vínculo com o cupom — por isso o
    // reprocessamento só alveja cupons ainda não processados, C2.5). O guard
    // (C9.2) espelha a trava da escrita real antes de cada inserção.
    if (poolPublicado) {
      const agoraPool = new Date().toISOString();
      for (const obs of dados.observacoes) {
        this.poolEntradas.push({ obs: garantirSemDadoPessoal(obs), criadoEm: agoraPool });
      }
    }

    cupom.status = 'processado';
    cupom.lojaCnpj = dados.loja.cnpj;
    cupom.emitidoEm = dados.emitidoEm;
    cupom.uf = dados.uf;
    if (dados.total) {
      cupom.descontoTotal = dados.total.desconto;
      cupom.valorPago = dados.total.pago;
    }
    return Promise.resolve({ poolPublicado });
  }

  marcarFalha(cupomId: string, motivo?: string): Promise<void> {
    const cupom = this.cupons.get(cupomId);
    if (cupom) {
      cupom.status = 'falha';
      cupom.falhaMotivo = motivo;
    }
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

  casarPorDescricao(sugestao: SugestaoProduto): Promise<string> {
    const chave = `${sugestao.descricaoNormalizada}|${sugestao.unidadeBase}`;
    const existente = this.produtosPorDescricao.get(chave);
    if (existente) return Promise.resolve(existente.id);

    const novo: ProdutoCanonicoInterno = {
      id: randomUUID(),
      descricaoNormalizada: sugestao.descricaoNormalizada,
      unidadeBase: sugestao.unidadeBase,
    };
    this.produtosPorDescricao.set(chave, novo);
    return Promise.resolve(novo.id);
  }

  // ───────────────────────── FonteProdutoConsulta (C4.1) ──────────────

  obterProdutoPorEan(ean: string): Promise<string | undefined> {
    return Promise.resolve(this.produtosPorEan.get(ean)?.id);
  }

  obterResumoProduto(produtoCanonicoId: string): Promise<ProdutoResumo | undefined> {
    const p = this.acharProdutoPorId(produtoCanonicoId);
    return Promise.resolve(p ? resumoDe(p) : undefined);
  }

  // Pré-filtro pelo token mais longo do nome (espelha o ilike do Supabase); o
  // serviço ranqueia por similaridade entre os candidatos resultantes.
  candidatosPorNome(nome: string): Promise<CandidatoCanonico[]> {
    const token = tokenizar(nome).sort((a, b) => b.length - a.length)[0];
    if (!token) return Promise.resolve([]);
    const r = [...this.todosProdutos()]
      .filter((p) => p.descricaoNormalizada.includes(token))
      .map((p) => ({ produtoCanonicoId: p.id, descricaoNormalizada: p.descricaoNormalizada }));
    return Promise.resolve(r);
  }

  // ───────────────────────── FonteBuscaProdutos (C4.4) ────────────────

  estatisticasNoEscopo(filtro: FiltroBuscaProdutos): Promise<PrecoEstatistica[]> {
    const escopos = new Set(filtro.escopoIds);
    const produtos = filtro.produtoCanonicoIds ? new Set(filtro.produtoCanonicoIds) : undefined;
    const r = [...this.estatisticas.values()]
      .filter((e) => escopos.has(e.escopoId))
      .filter((e) => (produtos ? produtos.has(e.produtoCanonicoId) : true))
      // Mais observadas primeiro: é o ranking de "populares na região" e, no
      // corte pelo limite, sobra o que tem mais base (espelha o adaptador real).
      .sort((a, b) => b.nObservacoes - a.nObservacoes)
      .slice(0, filtro.limite);
    return Promise.resolve(r);
  }

  resumosProdutos(produtoCanonicoIds: readonly string[]): Promise<ProdutoResumo[]> {
    const r = produtoCanonicoIds.flatMap((id) => {
      const p = this.acharProdutoPorId(id);
      return p ? [resumoDe(p)] : [];
    });
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

  observacoesDoProduto(
    produtoCanonicoId: string,
    desdeObservadoEm?: string,
  ): Promise<ObservacaoParaAgregacao[]> {
    const r = this.poolEntradas
      .map((e) => e.obs)
      .filter((o) => o.produtoCanonicoId === produtoCanonicoId)
      // Espelha o recorte que o adaptador real faz no SQL (janela do decaimento).
      .filter((o) => (desdeObservadoEm ? o.observadoEm >= desdeObservadoEm : true))
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
      // Espelha a coluna `seq` (identity) do banco: nasce com a linha e não
      // muda no update — é só o desempate do cursor keyset do delta sync.
      const seq = this.seqEstatistica.get(chave) ?? this.proximoSeq++;
      this.seqEstatistica.set(chave, seq);
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

  // ───────────────────────── FonteComparacaoLojas (C12.1) ─────────────

  estatisticasDeLojasPorProdutos(
    produtoCanonicoIds: readonly string[],
  ): Promise<EstatisticaLojaLinha[]> {
    const ids = new Set(produtoCanonicoIds);
    const r = [...this.estatisticas.values()]
      .filter((e) => e.escopo === 'loja' && ids.has(e.produtoCanonicoId))
      .map((e): EstatisticaLojaLinha => {
        const loja = this.lojas.get(e.escopoId);
        const nome = loja?.nomeFantasia ?? loja?.razaoSocial;
        return {
          produtoCanonicoId: e.produtoCanonicoId,
          lojaCnpj: e.escopoId,
          ...(nome ? { nomeLoja: nome } : {}),
          ...(loja?.municipio ? { municipioLoja: loja.municipio } : {}),
          ...(loja?.uf ? { ufLoja: loja.uf } : {}),
          ...(e.mediana != null ? { mediana: e.mediana } : {}),
          ...(e.menorPromocional != null ? { menorPromocional: e.menorPromocional } : {}),
          nObservacoes: e.nObservacoes,
        };
      });
    return Promise.resolve(r);
  }

  // ───────────────────────── FonteDeltaSync (C4.2) ────────────────────

  deltaEstatisticas(filtro: FiltroDeltaSync): Promise<LinhaDelta[]> {
    const escopos = filtro.escopoIds ? new Set(filtro.escopoIds) : undefined;
    const produtos = filtro.produtoCanonicoIds ? new Set(filtro.produtoCanonicoIds) : undefined;
    const desde = filtro.desde;
    const r = [...this.estatisticas.entries()]
      .map(([chave, estatistica]) => ({ seq: this.seqEstatistica.get(chave) ?? 0, estatistica }))
      // Mesmo predicado keyset do adaptador real: depois de (atualizadoEm, seq).
      .filter(({ estatistica: e, seq }) =>
        desde
          ? e.atualizadoEm > desde.atualizadoEm ||
            (e.atualizadoEm === desde.atualizadoEm && seq > desde.seq)
          : true,
      )
      .filter(({ estatistica: e }) => (escopos ? escopos.has(e.escopoId) : true))
      .filter(({ estatistica: e }) => (produtos ? produtos.has(e.produtoCanonicoId) : true))
      .sort(
        (a, b) =>
          a.estatistica.atualizadoEm.localeCompare(b.estatistica.atualizadoEm) || a.seq - b.seq,
      )
      .slice(0, filtro.limite);
    return Promise.resolve(r);
  }

  // ───────────────────────── FonteCandidatosTexto (C3.5) ──────────────

  listarCandidatos(unidadeBase: string): Promise<CandidatoCanonico[]> {
    const r = [...this.todosProdutos()]
      .filter((p) => p.unidadeBase === unidadeBase)
      .map((p) => ({
        produtoCanonicoId: p.id,
        descricaoNormalizada: p.descricaoNormalizada,
      }));
    return Promise.resolve(r);
  }

  // ───────────────────────── RepositorioDenuncia (C12.5) ──────────────

  existeProduto(produtoCanonicoId: string): Promise<boolean> {
    const achou = [...this.produtosPorEan.values(), ...this.produtosPorDescricao.values()].some(
      (p) => p.id === produtoCanonicoId,
    );
    return Promise.resolve(achou);
  }

  criarDenuncia(dados: DenunciaNova): Promise<DenunciaRegistrada> {
    // Espelha o índice único parcial: uma denúncia ABERTA por (usuário, produto).
    const aberta = [...this.denuncias.values()].find(
      (d) =>
        d.status === 'pendente' &&
        d.usuarioId === dados.usuarioId &&
        d.produtoCanonicoId === dados.produtoCanonicoId,
    );
    if (aberta) return Promise.resolve({ id: aberta.id, jaRegistrada: true });

    const id = randomUUID();
    this.denuncias.set(id, {
      ...dados,
      id,
      status: 'pendente',
      criadoEm: new Date().toISOString(),
    });
    return Promise.resolve({ id, jaRegistrada: false });
  }

  listarDenunciasPendentes(limite?: number): Promise<DenunciaCuradoria[]> {
    const pendentes = [...this.denuncias.values()].filter((d) => d.status === 'pendente');
    // Volume por produto: o sinal forte para priorizar a fila.
    const abertasPorProduto = new Map<string, number>();
    for (const d of pendentes) {
      abertasPorProduto.set(
        d.produtoCanonicoId,
        (abertasPorProduto.get(d.produtoCanonicoId) ?? 0) + 1,
      );
    }

    const fila = pendentes
      .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
      .map((d) => this.denunciaParaCuradoria(d, abertasPorProduto.get(d.produtoCanonicoId) ?? 1));
    return Promise.resolve(limite ? fila.slice(0, limite) : fila);
  }

  decidirDenuncia(id: string, procedente: boolean, resolucao?: string): Promise<boolean> {
    const d = this.denuncias.get(id);
    if (!d || d.status !== 'pendente') return Promise.resolve(false);
    d.status = procedente ? 'aprovado' : 'rejeitado';
    d.resolucao = resolucao;
    d.decididoEm = new Date().toISOString();
    return Promise.resolve(true);
  }

  /** Visão de curadoria: TUDO menos `usuarioId` (docs/04). */
  private denunciaParaCuradoria(d: DenunciaInterna, abertasNoProduto: number): DenunciaCuradoria {
    return {
      id: d.id,
      produtoCanonicoId: d.produtoCanonicoId,
      motivo: d.motivo,
      ...(d.municipio ? { municipio: d.municipio } : {}),
      ...(d.uf ? { uf: d.uf } : {}),
      ...(d.comentario ? { comentario: d.comentario } : {}),
      status: d.status,
      criadoEm: d.criadoEm,
      abertasNoProduto,
    };
  }

  // ───────────────────────── RepositorioModeracao (C11.3) ─────────────

  criar(dados: LancamentoModeracaoNovo): Promise<string> {
    const id = randomUUID();
    this.lancamentos.set(id, {
      ...dados,
      id,
      status: 'pendente',
      criadoEm: new Date().toISOString(),
    });
    return Promise.resolve(id);
  }

  listarPendentes(limite?: number): Promise<LancamentoModeracaoRegistro[]> {
    const pendentes = [...this.lancamentos.values()]
      .filter((l) => l.status === 'pendente')
      .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
      .map((l) => this.lancamentoParaRegistro(l));
    return Promise.resolve(limite ? pendentes.slice(0, limite) : pendentes);
  }

  obter(id: string): Promise<LancamentoModeracaoRegistro | undefined> {
    const l = this.lancamentos.get(id);
    return Promise.resolve(l ? this.lancamentoParaRegistro(l) : undefined);
  }

  rejeitar(id: string, motivo?: string): Promise<void> {
    const l = this.lancamentos.get(id);
    if (l && l.status === 'pendente') {
      l.status = 'rejeitado';
      l.motivo = motivo;
      l.decididoEm = new Date().toISOString();
    }
    return Promise.resolve();
  }

  aprovar(id: string, loja: LojaModeracao, observacao: ObservacaoAnonima): Promise<void> {
    const l = this.lancamentos.get(id);
    // Trava de transição: só publica o que estava pendente (idempotência).
    if (!l || l.status !== 'pendente') return Promise.resolve();
    l.status = 'aprovado';
    l.decididoEm = new Date().toISOString();

    // Upsert mínimo da loja (não sobrescreve dados ricos vindos de cupom).
    const existente = this.lojas.get(loja.cnpj);
    this.lojas.set(loja.cnpj, {
      cnpj: loja.cnpj,
      ...existente,
      municipio: existente?.municipio ?? loja.municipio,
      uf: existente?.uf ?? loja.uf,
    });

    // Pool anônimo — guard espelha a trava da escrita real (C9.2).
    this.poolEntradas.push({
      obs: garantirSemDadoPessoal(observacao),
      criadoEm: new Date().toISOString(),
    });
    return Promise.resolve();
  }

  // ───────────────────────── RepositorioCuradoria (C11.5) ─────────────

  listarProdutosParaEnriquecer(limite: number): Promise<AlvoEnriquecimento[]> {
    const alvos: AlvoEnriquecimento[] = [];
    for (const [ean, p] of this.produtosPorEan) {
      if (p.nomeExibicao == null) alvos.push({ produtoCanonicoId: p.id, ean });
      if (alvos.length >= limite) break;
    }
    return Promise.resolve(alvos);
  }

  enriquecerProduto(dados: EnriquecimentoProduto): Promise<string | undefined> {
    const alvo = dados.produtoCanonicoId
      ? this.acharProdutoPorId(dados.produtoCanonicoId)
      : dados.ean
        ? this.produtosPorEan.get(dados.ean)
        : undefined;
    if (!alvo) return Promise.resolve(undefined);
    if (dados.nomeExibicao != null) alvo.nomeExibicao = dados.nomeExibicao;
    if (dados.marca != null) alvo.marca = dados.marca;
    if (dados.categoria != null) alvo.categoria = dados.categoria;
    if (dados.imagemUrl != null) alvo.imagemUrl = dados.imagemUrl;
    return Promise.resolve(alvo.id);
  }

  private acharProdutoPorId(id: string): ProdutoCanonicoInterno | undefined {
    for (const p of this.todosProdutos()) {
      if (p.id === id) return p;
    }
    return undefined;
  }

  private *todosProdutos(): IterableIterator<ProdutoCanonicoInterno> {
    yield* this.produtosPorEan.values();
    yield* this.produtosPorDescricao.values();
  }

  private lancamentoParaRegistro(l: LancamentoModeracaoInterno): LancamentoModeracaoRegistro {
    return {
      id: l.id,
      ean: l.ean,
      descricao: l.descricao,
      unidade: l.unidade,
      valorUnitario: l.valorUnitario,
      lojaCnpj: l.lojaCnpj,
      ...(l.municipio ? { municipio: l.municipio } : {}),
      ...(l.uf ? { uf: l.uf } : {}),
      emPromocao: l.emPromocao,
      status: l.status,
      criadoEm: l.criadoEm,
    };
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

  motivoDaFalha(cupomId: string): string | undefined {
    return this.cupons.get(cupomId)?.falhaMotivo;
  }

  totalProdutos(): number {
    return this.produtosPorEan.size + this.produtosPorDescricao.size;
  }

  totalLojas(): number {
    return this.lojas.size;
  }

  /** Semeia uma loja direto (testes da comparação de lista, C12.1). */
  semearLoja(loja: Loja): void {
    this.lojas.set(loja.cnpj, loja);
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
