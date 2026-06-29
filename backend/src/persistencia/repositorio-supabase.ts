/**
 * Adaptador de persistência no Supabase/Postgres. Implementa `RepositorioCupom`
 * e `CatalogoProdutos` sobre as tabelas do domínio v1 (supabase/migrations).
 *
 * Separação privado/compartilhado preservada: o lado privado escreve em
 * `cupom`/`item_cupom`; o pool só recebe `ObservacaoAnonima` (tipo que só o
 * gate produz). Erros do banco são LANÇADOS — o processador os trata como
 * transitórios e a fila dá retry (C2.1).
 *
 * Atomicidade (C9.3.1): `marcarProcessado` roda as 4 escritas (loja, itens,
 * pool, status) numa transação única via a função SQL `processar_cupom`
 * (supabase/migrations) — evita duplicar no pool numa falha parcial do retry.
 */

import {
  garantirSemDadoPessoal,
  type ObservacaoAnonima,
  type PrecoEstatistica,
  type ProdutoResumo,
} from '@barganha/shared';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { CatalogoProdutos, SugestaoProduto } from '../anonimizacao/casamento';
import type { RepositorioUsuario } from '../auth/tipos';
import type { FonteProdutoConsulta } from '../consulta/tipos';
import type { EnriquecimentoProduto, RepositorioCuradoria } from '../curadoria/tipos';
import {
  type CandidatoCanonico,
  type FonteCandidatosTexto,
  tokenizar,
} from '../estatistica/casamento-texto';
import { derivarEscopos, type LocalGeo } from '../estatistica/escopos';
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

const COD_UNIQUE_VIOLATION = '23505';

function falhar(contexto: string, erro: PostgrestError): never {
  throw new Error(`Supabase: ${contexto} — ${erro.message} (${erro.code ?? 's/ código'}).`);
}

const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v));

export class RepositorioSupabase
  implements
    RepositorioCupom,
    RepositorioUsuario,
    CatalogoProdutos,
    FonteProdutoConsulta,
    FonteObservacoes,
    RepositorioEstatistica,
    FonteDeltaSync,
    FonteCandidatosTexto,
    RepositorioModeracao,
    RepositorioCuradoria
{
  constructor(private readonly db: SupabaseClient) {}

  // ───────────────────────── RepositorioUsuario (C4.3) ────────────────

  async criarAnonimo(): Promise<string> {
    const r = await this.db.from('usuario').insert({}).select('id').single();
    if (r.error) falhar('criação de conta anônima', r.error);
    return r.data.id;
  }

  async existe(id: string): Promise<boolean> {
    const r = await this.db.from('usuario').select('id').eq('id', id).maybeSingle();
    if (r.error) falhar('verificação de conta', r.error);
    return r.data != null;
  }

  async criarOuObterPorChave(dados: DadosIngestao): Promise<ResultadoIngestao> {
    if (dados.chaveAcesso) {
      const existente = await this.db
        .from('cupom')
        .select('id, status')
        .eq('usuario_id', dados.usuarioId)
        .eq('chave_acesso', dados.chaveAcesso)
        .maybeSingle();
      if (existente.error) falhar('consulta de cupom por chave', existente.error);
      if (existente.data) {
        return { cupomId: existente.data.id, status: existente.data.status, novo: false };
      }
    }

    const inserido = await this.db
      .from('cupom')
      .insert({
        usuario_id: dados.usuarioId,
        chave_acesso: dados.chaveAcesso ?? null,
        uf: dados.uf ?? null,
        qr_payload: dados.qrPayload,
        capturado_em: dados.capturadoEm,
        status: 'qr_capturado',
      })
      .select('id, status')
      .single();

    // Corrida: outro request inseriu a mesma chave entre o select e o insert.
    if (inserido.error?.code === COD_UNIQUE_VIOLATION && dados.chaveAcesso) {
      const r = await this.db
        .from('cupom')
        .select('id, status')
        .eq('usuario_id', dados.usuarioId)
        .eq('chave_acesso', dados.chaveAcesso)
        .single();
      if (r.error) falhar('reconsulta de cupom após conflito', r.error);
      return { cupomId: r.data.id, status: r.data.status, novo: false };
    }
    if (inserido.error) falhar('inserção de cupom', inserido.error);

    return { cupomId: inserido.data.id, status: inserido.data.status, novo: true };
  }

  async obterParaProcessamento(cupomId: string): Promise<CupomRegistro | undefined> {
    const r = await this.db
      .from('cupom')
      .select('id, usuario_id, uf, chave_acesso, qr_payload, status')
      .eq('id', cupomId)
      .maybeSingle();
    if (r.error) falhar('carga de cupom para processamento', r.error);
    if (!r.data) return undefined;
    return {
      id: r.data.id,
      usuarioId: r.data.usuario_id,
      uf: r.data.uf ?? undefined,
      chaveAcesso: r.data.chave_acesso ?? undefined,
      qrPayload: r.data.qr_payload,
      status: r.data.status,
    };
  }

  async obterDoUsuario(cupomId: string, usuarioId: string): Promise<CupomComItens | undefined> {
    // Gate de acesso na própria consulta: `usuario_id` casa o dono.
    const c = await this.db
      .from('cupom')
      .select('id, status, emitido_em, uf, loja_cnpj')
      .eq('id', cupomId)
      .eq('usuario_id', usuarioId)
      .maybeSingle();
    if (c.error) falhar('carga de cupom do usuário', c.error);
    if (!c.data) return undefined;

    const itensR = await this.db
      .from('item_cupom')
      .select(
        'produto_canonico_id, descricao_original, ean, quantidade, unidade, valor_unitario, valor_total, desconto',
      )
      .eq('cupom_id', cupomId);
    if (itensR.error) falhar('carga de itens do cupom', itensR.error);

    let loja: CupomComItens['loja'];
    if (c.data.loja_cnpj) {
      const l = await this.db
        .from('loja')
        .select('cnpj, razao_social, nome_fantasia, municipio, uf')
        .eq('cnpj', c.data.loja_cnpj)
        .maybeSingle();
      if (l.error) falhar('carga da loja do cupom', l.error);
      if (l.data) {
        loja = {
          cnpj: l.data.cnpj,
          ...(l.data.razao_social ? { razaoSocial: l.data.razao_social } : {}),
          ...(l.data.nome_fantasia ? { nomeFantasia: l.data.nome_fantasia } : {}),
          ...(l.data.municipio ? { municipio: l.data.municipio } : {}),
          ...(l.data.uf ? { uf: l.data.uf } : {}),
        };
      }
    }

    return {
      cupomId: c.data.id,
      status: c.data.status,
      ...(c.data.emitido_em ? { emitidoEm: c.data.emitido_em } : {}),
      ...(c.data.uf ? { uf: c.data.uf } : {}),
      ...(loja ? { loja } : {}),
      itens: (itensR.data ?? []).map((i) => ({
        ...(i.produto_canonico_id ? { produtoCanonicoId: i.produto_canonico_id } : {}),
        descricaoOriginal: i.descricao_original,
        ...(i.ean ? { ean: i.ean } : {}),
        quantidade: Number(i.quantidade),
        unidade: i.unidade,
        valorUnitario: Number(i.valor_unitario),
        valorTotal: Number(i.valor_total),
        ...(i.desconto != null ? { desconto: Number(i.desconto) } : {}),
      })),
    };
  }

  async marcarProcessado(cupomId: string, dados: DadosNotaProcessada): Promise<void> {
    // C9.2 — última trava antes do pool: aborta se algum campo proibido escapou
    // ao tipo (a escrita via RPC fala JSON, onde a marca do gate se perde).
    const observacoes = dados.observacoes.map((o) => garantirSemDadoPessoal(o));

    // C9.3.1 — TUDO numa transação única (loja + itens privados + pool + status).
    // A ordem/atomicidade vive na função SQL `processar_cupom`.
    const r = await this.db.rpc('processar_cupom', {
      p_cupom_id: cupomId,
      p_loja: {
        cnpj: dados.loja.cnpj,
        razao_social: dados.loja.razaoSocial ?? null,
        nome_fantasia: dados.loja.nomeFantasia ?? null,
        endereco: dados.loja.endereco ?? null,
        municipio: dados.loja.municipio ?? null,
        uf: dados.loja.uf ?? null,
      },
      p_emitido_em: dados.emitidoEm,
      p_uf: dados.uf,
      p_itens: dados.itensPrivados.map((i) => ({
        produto_canonico_id: i.produtoCanonicoId ?? null,
        descricao_original: i.descricaoOriginal,
        ean: i.ean ?? null,
        quantidade: i.quantidade,
        unidade: i.unidade,
        valor_unitario: i.valorUnitario,
        valor_total: i.valorTotal,
        desconto: i.desconto ?? null,
      })),
      p_observacoes: observacoes.map((o) => ({
        produto_canonico_id: o.produtoCanonicoId,
        loja_cnpj: o.lojaCnpj,
        municipio: o.municipio ?? null,
        uf: o.uf ?? null,
        preco_normalizado: o.precoNormalizado,
        unidade_base: o.unidadeBase,
        em_promocao: o.emPromocao,
        observado_em: o.observadoEm,
      })),
    });
    if (r.error) falhar('processamento transacional do cupom', r.error);
  }

  async marcarFalha(cupomId: string): Promise<void> {
    const r = await this.db
      .from('cupom')
      .update({ status: 'falha', atualizado_em: new Date().toISOString() })
      .eq('id', cupomId);
    if (r.error) falhar('marcação de falha do cupom', r.error);
  }

  async listarParaReprocessar(filtro: FiltroReprocessamento): Promise<string[]> {
    let consulta = this.db.from('cupom').select('id').in('status', filtro.status);
    if (filtro.uf) consulta = consulta.eq('uf', filtro.uf);
    if (filtro.limite !== undefined) consulta = consulta.limit(filtro.limite);
    const r = await consulta;
    if (r.error) falhar('listagem para reprocessamento', r.error);
    return (r.data ?? []).map((c) => c.id);
  }

  async casarPorEan(ean: string, sugestao: SugestaoProduto): Promise<string> {
    const existente = await this.db
      .from('produto_canonico')
      .select('id')
      .eq('ean', ean)
      .maybeSingle();
    if (existente.error) falhar('consulta de produto por EAN', existente.error);
    if (existente.data) return existente.data.id;

    const inserido = await this.db
      .from('produto_canonico')
      .insert({
        ean,
        descricao_normalizada: sugestao.descricaoNormalizada,
        unidade_base: sugestao.unidadeBase,
      })
      .select('id')
      .single();

    if (inserido.error?.code === COD_UNIQUE_VIOLATION) {
      const r = await this.db.from('produto_canonico').select('id').eq('ean', ean).single();
      if (r.error) falhar('reconsulta de produto após conflito', r.error);
      return r.data.id;
    }
    if (inserido.error) falhar('inserção de produto canônico', inserido.error);
    return inserido.data.id;
  }

  // ───────────────────────── FonteProdutoConsulta (C4.1) ──────────────

  async obterProdutoPorEan(ean: string): Promise<string | undefined> {
    const r = await this.db.from('produto_canonico').select('id').eq('ean', ean).maybeSingle();
    if (r.error) falhar('consulta de produto por EAN', r.error);
    return r.data?.id;
  }

  async obterResumoProduto(produtoCanonicoId: string): Promise<ProdutoResumo | undefined> {
    const r = await this.db
      .from('produto_canonico')
      .select('id, nome_exibicao, marca, categoria, imagem_url, unidade_base')
      .eq('id', produtoCanonicoId)
      .maybeSingle();
    if (r.error) falhar('carga do resumo de produto', r.error);
    if (!r.data) return undefined;
    return {
      produtoCanonicoId: r.data.id,
      ...(r.data.nome_exibicao ? { nomeExibicao: r.data.nome_exibicao } : {}),
      ...(r.data.marca ? { marca: r.data.marca } : {}),
      ...(r.data.categoria ? { categoria: r.data.categoria } : {}),
      ...(r.data.imagem_url ? { imagemUrl: r.data.imagem_url } : {}),
      unidadeBase: r.data.unidade_base,
    };
  }

  async candidatosPorNome(nome: string): Promise<CandidatoCanonico[]> {
    // Pré-filtro barato: o token mais longo do nome (já normalizado) via ilike,
    // reduzindo o conjunto a pontuar no serviço. Busca de texto plena fica p/ C9.3.
    const tokens = tokenizar(nome).sort((a, b) => b.length - a.length);
    const token = tokens[0];
    if (!token) return [];
    const r = await this.db
      .from('produto_canonico')
      .select('id, descricao_normalizada')
      .not('descricao_normalizada', 'is', null)
      .ilike('descricao_normalizada', `%${token}%`);
    if (r.error) falhar('busca de produtos por nome', r.error);
    return (r.data ?? []).map((p) => ({
      produtoCanonicoId: p.id,
      descricaoNormalizada: p.descricao_normalizada,
    }));
  }

  // ───────────────────────── FonteObservacoes (C3) ────────────────────

  async listarProdutosComObservacoes(desde?: string): Promise<string[]> {
    let consulta = this.db.from('observacao_preco').select('produto_canonico_id');
    // Sinal de "novo" = INSERÇÃO (criado_em), não emissão (observado_em): um
    // cupom antigo enviado hoje (offline-first) precisa disparar recálculo (F1).
    if (desde) consulta = consulta.gte('criado_em', desde);
    const r = await consulta;
    if (r.error) falhar('listagem de produtos com observação', r.error);
    return [...new Set((r.data ?? []).map((o) => o.produto_canonico_id as string))];
  }

  async observacoesDoProduto(produtoCanonicoId: string): Promise<ObservacaoParaAgregacao[]> {
    const r = await this.db
      .from('observacao_preco')
      .select(
        'produto_canonico_id, unidade_base, loja_cnpj, municipio, uf, preco_normalizado, em_promocao, observado_em',
      )
      .eq('produto_canonico_id', produtoCanonicoId);
    if (r.error) falhar('carga de observações do produto', r.error);
    return (r.data ?? []).map((o) => ({
      produtoCanonicoId: o.produto_canonico_id,
      unidadeBase: o.unidade_base,
      lojaCnpj: o.loja_cnpj,
      ...(o.municipio ? { municipio: o.municipio } : {}),
      ...(o.uf ? { uf: o.uf } : {}),
      precoNormalizado: Number(o.preco_normalizado),
      emPromocao: o.em_promocao,
      observadoEm: o.observado_em,
    }));
  }

  // ───────────────────────── RepositorioEstatistica (C3) ──────────────

  async upsertEstatisticas(linhas: readonly LinhaEstatistica[]): Promise<void> {
    if (linhas.length === 0) return;
    const agora = new Date().toISOString();
    const r = await this.db.from('preco_estatistica').upsert(
      linhas.map((l) => ({
        produto_canonico_id: l.produtoCanonicoId,
        escopo: l.escopo,
        escopo_id: l.escopoId,
        unidade_base: l.unidadeBase,
        mediana: l.mediana,
        p25: l.p25,
        p75: l.p75,
        minimo: l.minimo,
        maximo: l.maximo,
        menor_promocional: l.menorPromocional ?? null,
        n_observacoes: l.nObservacoes,
        atualizado_em: agora,
      })),
      { onConflict: 'produto_canonico_id,escopo,escopo_id,unidade_base' },
    );
    if (r.error) falhar('upsert de estatísticas', r.error);
  }

  async candidatosFallback(
    produtoCanonicoId: string,
    local: LocalGeo,
  ): Promise<PrecoEstatistica[]> {
    const escopoIds = derivarEscopos(local).map((e) => e.escopoId);
    if (escopoIds.length === 0) return [];
    const r = await this.db
      .from('preco_estatistica')
      .select('*')
      .eq('produto_canonico_id', produtoCanonicoId)
      .in('escopo_id', escopoIds);
    if (r.error) falhar('consulta de candidatos para fallback', r.error);
    return (r.data ?? []).map((e) => ({
      produtoCanonicoId: e.produto_canonico_id,
      escopo: e.escopo,
      escopoId: e.escopo_id,
      unidadeBase: e.unidade_base,
      mediana: num(e.mediana),
      p25: num(e.p25),
      p75: num(e.p75),
      minimo: num(e.minimo),
      maximo: num(e.maximo),
      menorPromocional: num(e.menor_promocional),
      nObservacoes: Number(e.n_observacoes),
      atualizadoEm: e.atualizado_em,
    }));
  }

  // ───────────────────────── FonteDeltaSync (C4.2) ────────────────────

  async deltaEstatisticas(filtro: FiltroDeltaSync): Promise<PrecoEstatistica[]> {
    let consulta = this.db.from('preco_estatistica').select('*');
    if (filtro.desde) consulta = consulta.gt('atualizado_em', filtro.desde);
    if (filtro.escopoIds && filtro.escopoIds.length > 0) {
      consulta = consulta.in('escopo_id', filtro.escopoIds);
    }
    if (filtro.produtoCanonicoIds && filtro.produtoCanonicoIds.length > 0) {
      consulta = consulta.in('produto_canonico_id', filtro.produtoCanonicoIds);
    }
    const r = await consulta.order('atualizado_em', { ascending: true }).limit(filtro.limite);
    if (r.error) falhar('leitura do delta de estatísticas', r.error);
    return (r.data ?? []).map((e) => ({
      produtoCanonicoId: e.produto_canonico_id,
      escopo: e.escopo,
      escopoId: e.escopo_id,
      unidadeBase: e.unidade_base,
      mediana: num(e.mediana),
      p25: num(e.p25),
      p75: num(e.p75),
      minimo: num(e.minimo),
      maximo: num(e.maximo),
      menorPromocional: num(e.menor_promocional),
      nObservacoes: Number(e.n_observacoes),
      atualizadoEm: e.atualizado_em,
    }));
  }

  // ───────────────────────── FonteCandidatosTexto (C3.5) ──────────────

  async listarCandidatos(unidadeBase: string): Promise<CandidatoCanonico[]> {
    const r = await this.db
      .from('produto_canonico')
      .select('id, descricao_normalizada')
      .eq('unidade_base', unidadeBase)
      .not('descricao_normalizada', 'is', null);
    if (r.error) falhar('listagem de candidatos para casamento por texto', r.error);
    return (r.data ?? []).map((p) => ({
      produtoCanonicoId: p.id,
      descricaoNormalizada: p.descricao_normalizada,
    }));
  }

  // ───────────────────────── RepositorioModeracao (C11.3) ─────────────

  async criar(dados: LancamentoModeracaoNovo): Promise<string> {
    const r = await this.db
      .from('lancamento_manual_moderacao')
      .insert({
        usuario_id: dados.usuarioId,
        ean: dados.ean,
        descricao: dados.descricao,
        unidade: dados.unidade,
        valor_unitario: dados.valorUnitario,
        loja_cnpj: dados.lojaCnpj,
        municipio: dados.municipio ?? null,
        uf: dados.uf ?? null,
        em_promocao: dados.emPromocao,
      })
      .select('id')
      .single();
    if (r.error) falhar('registro de lançamento manual', r.error);
    return r.data.id;
  }

  async listarPendentes(limite?: number): Promise<LancamentoModeracaoRegistro[]> {
    let consulta = this.db
      .from('lancamento_manual_moderacao')
      .select(
        'id, ean, descricao, unidade, valor_unitario, loja_cnpj, municipio, uf, em_promocao, status, criado_em',
      )
      .eq('status', 'pendente')
      .order('criado_em', { ascending: true });
    if (limite !== undefined) consulta = consulta.limit(limite);
    const r = await consulta;
    if (r.error) falhar('listagem da fila de moderação', r.error);
    return (r.data ?? []).map((l) => this.lancamentoParaRegistro(l));
  }

  async obter(id: string): Promise<LancamentoModeracaoRegistro | undefined> {
    const r = await this.db
      .from('lancamento_manual_moderacao')
      .select(
        'id, ean, descricao, unidade, valor_unitario, loja_cnpj, municipio, uf, em_promocao, status, criado_em',
      )
      .eq('id', id)
      .maybeSingle();
    if (r.error) falhar('carga de lançamento manual', r.error);
    return r.data ? this.lancamentoParaRegistro(r.data) : undefined;
  }

  async rejeitar(id: string, motivo?: string): Promise<void> {
    const r = await this.db
      .from('lancamento_manual_moderacao')
      .update({
        status: 'rejeitado',
        motivo: motivo ?? null,
        decidido_em: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pendente');
    if (r.error) falhar('rejeição de lançamento manual', r.error);
  }

  async aprovar(id: string, loja: LojaModeracao, observacao: ObservacaoAnonima): Promise<void> {
    // C9.2 — última trava antes do pool: aborta se algum campo proibido escapou.
    const obs = garantirSemDadoPessoal(observacao);
    // Transição + loja + pool numa transação única (idempotente na função SQL).
    const r = await this.db.rpc('aprovar_lancamento_manual', {
      p_id: id,
      p_loja: { cnpj: loja.cnpj, municipio: loja.municipio ?? null, uf: loja.uf ?? null },
      p_observacao: {
        produto_canonico_id: obs.produtoCanonicoId,
        loja_cnpj: obs.lojaCnpj,
        municipio: obs.municipio ?? null,
        uf: obs.uf ?? null,
        preco_normalizado: obs.precoNormalizado,
        unidade_base: obs.unidadeBase,
        em_promocao: obs.emPromocao,
        observado_em: obs.observadoEm,
      },
    });
    if (r.error) falhar('aprovação transacional de lançamento manual', r.error);
  }

  private lancamentoParaRegistro(l: {
    id: string;
    ean: string;
    descricao: string;
    unidade: string;
    valor_unitario: unknown;
    loja_cnpj: string;
    municipio: string | null;
    uf: string | null;
    em_promocao: boolean;
    status: LancamentoModeracaoRegistro['status'];
    criado_em: string;
  }): LancamentoModeracaoRegistro {
    return {
      id: l.id,
      ean: l.ean,
      descricao: l.descricao,
      unidade: l.unidade,
      valorUnitario: Number(l.valor_unitario),
      lojaCnpj: l.loja_cnpj,
      ...(l.municipio ? { municipio: l.municipio } : {}),
      ...(l.uf ? { uf: l.uf } : {}),
      emPromocao: l.em_promocao,
      status: l.status,
      criadoEm: l.criado_em,
    };
  }

  // ───────────────────────── RepositorioCuradoria (C11.5) ─────────────

  async enriquecerProduto(dados: EnriquecimentoProduto): Promise<string | undefined> {
    // Só os campos de EXIBIÇÃO — nunca descricao_normalizada/ean (base do casamento).
    const patch: Record<string, string> = {};
    if (dados.nomeExibicao != null) patch.nome_exibicao = dados.nomeExibicao;
    if (dados.marca != null) patch.marca = dados.marca;
    if (dados.categoria != null) patch.categoria = dados.categoria;
    if (dados.imagemUrl != null) patch.imagem_url = dados.imagemUrl;
    patch.atualizado_em = new Date().toISOString();

    let consulta = this.db.from('produto_canonico').update(patch);
    consulta = dados.produtoCanonicoId
      ? consulta.eq('id', dados.produtoCanonicoId)
      : consulta.eq('ean', dados.ean as string);
    const r = await consulta.select('id').maybeSingle();
    if (r.error) falhar('enriquecimento de produto', r.error);
    return r.data?.id;
  }
}
