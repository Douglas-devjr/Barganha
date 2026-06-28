/**
 * Adaptador de persistência no Supabase/Postgres. Implementa `RepositorioCupom`
 * e `CatalogoProdutos` sobre as tabelas do domínio v1 (supabase/migrations).
 *
 * Separação privado/compartilhado preservada: o lado privado escreve em
 * `cupom`/`item_cupom`; o pool só recebe `ObservacaoAnonima` (tipo que só o
 * gate produz). Erros do banco são LANÇADOS — o processador os trata como
 * transitórios e a fila dá retry (C2.1).
 *
 * NOTA (atomicidade): `marcarProcessado` faz escritas sequenciais. Para
 * produção, mover para uma função SQL (RPC) que rode tudo numa transação —
 * registrado em C9.3.1. O reprocessamento (C2.5) só alveja cupons
 * não-`processado`, então não há dupla contagem no pool.
 */

import type { ObservacaoAnonima, PrecoEstatistica } from '@barganha/shared';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { CatalogoProdutos, SugestaoProduto } from '../anonimizacao/casamento';
import type { RepositorioUsuario } from '../auth/tipos';
import type { FonteProdutoConsulta } from '../consulta/tipos';
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
import type { FiltroDeltaSync, FonteDeltaSync } from '../sync/tipos';
import type {
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
    FonteCandidatosTexto
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

  async marcarProcessado(cupomId: string, dados: DadosNotaProcessada): Promise<void> {
    // 1) Loja (compartilhado) — upsert pela PK cnpj.
    const loja = await this.db.from('loja').upsert(
      {
        cnpj: dados.loja.cnpj,
        razao_social: dados.loja.razaoSocial,
        nome_fantasia: dados.loja.nomeFantasia ?? null,
        endereco: dados.loja.endereco,
        municipio: dados.loja.municipio,
        uf: dados.loja.uf,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'cnpj' },
    );
    if (loja.error) falhar('upsert de loja', loja.error);

    // 2) Itens privados — substitui os anteriores (reprocessamento).
    const del = await this.db.from('item_cupom').delete().eq('cupom_id', cupomId);
    if (del.error) falhar('limpeza de itens do cupom', del.error);

    if (dados.itensPrivados.length > 0) {
      const itens = await this.db.from('item_cupom').insert(
        dados.itensPrivados.map((i) => ({
          cupom_id: cupomId,
          produto_canonico_id: i.produtoCanonicoId ?? null,
          descricao_original: i.descricaoOriginal,
          ean: i.ean ?? null,
          quantidade: i.quantidade,
          unidade: i.unidade,
          valor_unitario: i.valorUnitario,
          valor_total: i.valorTotal,
          desconto: i.desconto ?? null,
        })),
      );
      if (itens.error) falhar('inserção de itens do cupom', itens.error);
    }

    // 3) Pool anônimo — só `ObservacaoAnonima` (garantia do gate).
    await this.inserirObservacoes(dados.observacoes);

    // 4) Conclui o cupom (privado).
    const upd = await this.db
      .from('cupom')
      .update({
        loja_cnpj: dados.loja.cnpj,
        emitido_em: dados.emitidoEm,
        uf: dados.uf,
        status: 'processado',
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', cupomId);
    if (upd.error) falhar('conclusão do cupom', upd.error);
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

  /** Escrita do pool — aceita SOMENTE `ObservacaoAnonima` (vinda do gate). */
  private async inserirObservacoes(observacoes: ObservacaoAnonima[]): Promise<void> {
    if (observacoes.length === 0) return;
    const r = await this.db.from('observacao_preco').insert(
      observacoes.map((o) => ({
        produto_canonico_id: o.produtoCanonicoId,
        loja_cnpj: o.lojaCnpj,
        municipio: o.municipio ?? null,
        uf: o.uf ?? null,
        preco_normalizado: o.precoNormalizado,
        unidade_base: o.unidadeBase,
        em_promocao: o.emPromocao,
        observado_em: o.observadoEm,
      })),
    );
    if (r.error) falhar('inserção de observações no pool', r.error);
  }
}
