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
 * acompanhar em performance/escala (C9.3). O reprocessamento (C2.5) só alveja
 * cupons não-`processado`, então não há dupla contagem no pool.
 */

import type { ObservacaoAnonima } from '@barganha/shared';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { CatalogoProdutos, SugestaoProduto } from '../anonimizacao/casamento';
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

export class RepositorioSupabase implements RepositorioCupom, CatalogoProdutos {
  constructor(private readonly db: SupabaseClient) {}

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
