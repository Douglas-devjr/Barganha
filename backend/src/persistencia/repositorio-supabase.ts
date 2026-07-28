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
  type DenunciaCuradoria,
  garantirSemDadoPessoal,
  type MotivoDenuncia,
  type ObservacaoAnonima,
  type PrecoEstatistica,
  type ProdutoResumo,
  type StatusModeracao,
  type TipicoNaCompra,
  type TotaisNota,
} from '@barganha/shared';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

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
import type {
  DenunciaNova,
  DenunciaRegistrada,
  RepositorioDenuncia,
} from '../moderacao/tipos-denuncia';
import type { FiltroDeltaSync, FonteDeltaSync, LinhaDelta } from '../sync/tipos';
import type {
  CupomComItens,
  CupomHistorico,
  CupomRegistro,
  CursorHistorico,
  DadosIngestao,
  DadosNotaProcessada,
  FiltroReprocessamento,
  RepositorioCupom,
  ResultadoIngestao,
  ResultadoMarcarProcessado,
} from './tipos';

const COD_UNIQUE_VIOLATION = '23505';

function falhar(contexto: string, erro: PostgrestError): never {
  throw new Error(`Supabase: ${contexto} — ${erro.message} (${erro.code ?? 's/ código'}).`);
}

const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v));

/**
 * Tamanho da página das varreduras. O PostgREST tem um teto de linhas por
 * resposta (`max_rows`) e o aplica em SILÊNCIO: uma consulta sem `range`
 * devolve menos dados, sem erro nenhum. Toda leitura que pode crescer sem
 * limite passa por `paginar`.
 *
 * ATENÇÃO: este valor está AMARRADO ao `max_rows` do PostgREST
 * (`supabase/config.toml` → `[api] max_rows`, e a mesma opção em API Settings no
 * projeto de nuvem). `paginar` encerra ao receber uma página incompleta, então
 * um `max_rows` MENOR que isto seria lido como "acabaram os dados" e voltaria a
 * truncar em silêncio. Mudou lá, mude aqui.
 */
const PAGINA = 1000;

/**
 * Teto de segurança da carga de observações de UM produto na agregação. Um
 * produto muito popular numa janela de 180 dias pode ter centenas de milhares
 * de linhas; carregá-las todas na memória do Node é o que quebraria antes.
 * Como a leitura vem ordenada por `observado_em` DESC, o corte descarta a cauda
 * de menor peso temporal — truncar aqui é uma aproximação principiada, não uma
 * amostra arbitrária. Ver `observacoesDoProduto`.
 */
export const MAX_OBSERVACOES_AGREGACAO = 50_000;

interface RespostaPagina<T> {
  data: T[] | null;
  error: PostgrestError | null;
}

/**
 * Uma linha de `preco_estatistica` na forma do domínio. Os numéricos do Postgres
 * chegam como string no PostgREST — daí o `num` em cada faixa.
 */
function paraEstatistica(e: Record<string, unknown>): PrecoEstatistica {
  return {
    produtoCanonicoId: e.produto_canonico_id as string,
    escopo: e.escopo as PrecoEstatistica['escopo'],
    escopoId: e.escopo_id as string,
    unidadeBase: e.unidade_base as PrecoEstatistica['unidadeBase'],
    mediana: num(e.mediana),
    p25: num(e.p25),
    p75: num(e.p75),
    minimo: num(e.minimo),
    maximo: num(e.maximo),
    menorPromocional: num(e.menor_promocional),
    nObservacoes: Number(e.n_observacoes),
    atualizadoEm: e.atualizado_em as string,
  };
}

/**
 * Uma linha de `item_cupom` na forma do domínio (lado PRIVADO). Os numéricos do
 * Postgres chegam como string no PostgREST — daí o `num`.
 *
 * O `tipicoNaCompra` só é montado com os QUATRO campos presentes: mediana sem
 * escopo/`n` não é auditável, e meia-informação aqui viraria número exibido sem
 * lastro. Ausência é a resposta honesta.
 */
function paraItemPrivado(i: Record<string, unknown>): ItemCupomNovo {
  const mediana = num(i.tipico_mediana);
  const unidadeBase = i.tipico_unidade_base as TipicoNaCompra['unidadeBase'] | null;
  const escopo = i.tipico_escopo as TipicoNaCompra['escopo'] | null;
  const nObservacoes = num(i.tipico_n_observacoes);
  const tipicoNaCompra: TipicoNaCompra | undefined =
    mediana != null && unidadeBase != null && escopo != null && nObservacoes != null
      ? { mediana, unidadeBase, escopo, nObservacoes }
      : undefined;

  return {
    ...(i.produto_canonico_id ? { produtoCanonicoId: i.produto_canonico_id as string } : {}),
    descricaoOriginal: i.descricao_original as string,
    ...(i.ean ? { ean: i.ean as string } : {}),
    quantidade: Number(i.quantidade),
    unidade: i.unidade as string,
    valorUnitario: Number(i.valor_unitario),
    valorTotal: Number(i.valor_total),
    ...(i.desconto != null ? { desconto: Number(i.desconto) } : {}),
    ...(tipicoNaCompra ? { tipicoNaCompra } : {}),
  };
}

/** Uma linha de `produto_canonico` no resumo de exibição da UI (C11.5). */
function paraResumoProduto(p: Record<string, unknown>): ProdutoResumo {
  return {
    produtoCanonicoId: p.id as string,
    ...(p.nome_exibicao ? { nomeExibicao: p.nome_exibicao as string } : {}),
    ...(p.marca ? { marca: p.marca as string } : {}),
    ...(p.categoria ? { categoria: p.categoria as string } : {}),
    ...(p.imagem_url ? { imagemUrl: p.imagem_url as string } : {}),
    unidadeBase: p.unidade_base as ProdutoResumo['unidadeBase'],
  };
}

/** Projeção crua de `observacao_preco` usada pela agregação. */
interface LinhaObservacaoBruta {
  produto_canonico_id: string;
  unidade_base: ObservacaoParaAgregacao['unidadeBase'];
  loja_cnpj: string;
  municipio: string | null;
  uf: string | null;
  preco_normalizado: unknown;
  em_promocao: boolean;
  observado_em: string;
}

/**
 * Varre uma consulta em páginas de `PAGINA` linhas até esgotar (ou bater
 * `maximo`). Existe porque o teto do PostgREST trunca sem avisar — ver `PAGINA`.
 */
async function paginar<T>(
  contexto: string,
  pagina: (de: number, ate: number) => PromiseLike<RespostaPagina<T>>,
  maximo = Number.POSITIVE_INFINITY,
): Promise<T[]> {
  const acumulado: T[] = [];
  for (let de = 0; de < maximo; de += PAGINA) {
    const ate = Math.min(de + PAGINA, maximo) - 1;
    const r = await pagina(de, ate);
    if (r.error) falhar(contexto, r.error);
    const lote = r.data ?? [];
    acumulado.push(...lote);
    // Página incompleta = acabou. (Uma página cheia pode ser a última; a próxima
    // volta vazia e encerra — uma ida a mais é mais barata que perder dados.)
    if (lote.length < ate - de + 1) break;
  }
  return acumulado;
}

export class RepositorioSupabase
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
      .select('id, status, emitido_em, uf, loja_cnpj, desconto_total, valor_pago')
      .eq('id', cupomId)
      .eq('usuario_id', usuarioId)
      .maybeSingle();
    if (c.error) falhar('carga de cupom do usuário', c.error);
    if (!c.data) return undefined;

    const itensR = await this.db
      .from('item_cupom')
      .select(
        'produto_canonico_id, descricao_original, ean, quantidade, unidade, valor_unitario, valor_total, desconto, tipico_mediana, tipico_unidade_base, tipico_escopo, tipico_n_observacoes',
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
      ...(c.data.desconto_total != null ? { descontoTotal: Number(c.data.desconto_total) } : {}),
      ...(c.data.valor_pago != null ? { valorPago: Number(c.data.valor_pago) } : {}),
      itens: (itensR.data ?? []).map((i) => paraItemPrivado(i)),
    };
  }

  async listarHistoricoDoUsuario(
    usuarioId: string,
    opcoes: { limite: number; apos?: CursorHistorico },
  ): Promise<CupomHistorico[]> {
    // Gate de acesso na própria consulta (`usuario_id`). Keyset (capturado_em,
    // id) para a página ser estável mesmo com capturas no mesmo instante.
    let q = this.db
      .from('cupom')
      .select(
        'id, status, qr_payload, chave_acesso, capturado_em, emitido_em, uf, loja_cnpj, desconto_total, valor_pago',
      )
      .eq('usuario_id', usuarioId);
    if (opcoes.apos) {
      // Timestamp entre aspas (mesmo cuidado do delta): o valor é interpolado
      // numa expressão PostgREST. O id é UUID (sem caractere de sintaxe).
      const ts = `"${opcoes.apos.capturadoEm.replace(/"/g, '')}"`;
      q = q.or(`capturado_em.gt.${ts},and(capturado_em.eq.${ts},id.gt.${opcoes.apos.cupomId})`);
    }
    const c = await q
      .order('capturado_em', { ascending: true })
      .order('id', { ascending: true })
      .limit(opcoes.limite);
    if (c.error) falhar('listagem do histórico do usuário (restore)', c.error);
    const cupons = c.data ?? [];
    if (cupons.length === 0) return [];

    // Itens e lojas em LOTE (uma consulta cada), não N+1 por cupom.
    const ids = cupons.map((x) => x.id as string);
    const itensR = await this.db
      .from('item_cupom')
      .select(
        'cupom_id, produto_canonico_id, descricao_original, ean, quantidade, unidade, valor_unitario, valor_total, desconto, tipico_mediana, tipico_unidade_base, tipico_escopo, tipico_n_observacoes',
      )
      .in('cupom_id', ids);
    if (itensR.error) falhar('carga de itens do histórico (restore)', itensR.error);
    const itensPorCupom = new Map<string, CupomComItens['itens']>();
    for (const i of itensR.data ?? []) {
      const lista = itensPorCupom.get(i.cupom_id as string) ?? [];
      lista.push(paraItemPrivado(i));
      itensPorCupom.set(i.cupom_id as string, lista);
    }

    const cnpjs = [...new Set(cupons.map((x) => x.loja_cnpj as string | null).filter(Boolean))];
    const lojas = new Map<string, CupomComItens['loja']>();
    if (cnpjs.length > 0) {
      const lr = await this.db
        .from('loja')
        .select('cnpj, razao_social, nome_fantasia, municipio, uf')
        .in('cnpj', cnpjs as string[]);
      if (lr.error) falhar('carga de lojas do histórico (restore)', lr.error);
      for (const l of lr.data ?? []) {
        lojas.set(l.cnpj as string, {
          cnpj: l.cnpj as string,
          ...(l.razao_social ? { razaoSocial: l.razao_social as string } : {}),
          ...(l.nome_fantasia ? { nomeFantasia: l.nome_fantasia as string } : {}),
          ...(l.municipio ? { municipio: l.municipio as string } : {}),
          ...(l.uf ? { uf: l.uf as string } : {}),
        });
      }
    }

    return cupons.map((x) => {
      const loja = x.loja_cnpj ? lojas.get(x.loja_cnpj as string) : undefined;
      return {
        cupomId: x.id as string,
        status: x.status,
        qrPayload: x.qr_payload as string,
        ...(x.chave_acesso ? { chaveAcesso: x.chave_acesso as string } : {}),
        capturadoEm: x.capturado_em as string,
        ...(x.emitido_em ? { emitidoEm: x.emitido_em as string } : {}),
        ...(x.uf ? { uf: x.uf as string } : {}),
        ...(loja ? { loja } : {}),
        ...(x.desconto_total != null ? { descontoTotal: Number(x.desconto_total) } : {}),
        ...(x.valor_pago != null ? { valorPago: Number(x.valor_pago) } : {}),
        itens: itensPorCupom.get(x.id as string) ?? [],
      };
    });
  }

  async apagarDoUsuario(cupomId: string, usuarioId: string): Promise<boolean> {
    // Gate de acesso na própria escrita: o `usuario_id` no WHERE garante que
    // ninguém apaga cupom de terceiro, mesmo adivinhando o id. Os itens saem por
    // `on delete cascade`; o pool não é tocado (ver a doc da porta em tipos.ts).
    const r = await this.db
      .from('cupom')
      .delete()
      .eq('id', cupomId)
      .eq('usuario_id', usuarioId)
      .select('id');
    if (r.error) falhar('exclusão de cupom do usuário', r.error);
    return (r.data?.length ?? 0) > 0;
  }

  async atualizarTotais(cupomId: string, total: TotaisNota): Promise<void> {
    // Guarda dupla: só cupom `processado` e SÓ quando ainda sem totais
    // (`valor_pago` nulo) — nunca sobrescreve o que a captura já gravou.
    const r = await this.db
      .from('cupom')
      .update({
        desconto_total: total.desconto,
        valor_pago: total.pago,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', cupomId)
      .eq('status', 'processado')
      .is('valor_pago', null);
    if (r.error) falhar('backfill de totais do cupom (C2.6)', r.error);
  }

  async marcarProcessado(
    cupomId: string,
    dados: DadosNotaProcessada,
    opcoes?: { sobrescreverProcessado?: boolean },
  ): Promise<ResultadoMarcarProcessado> {
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
        // Snapshot do típico da região no processamento — os 4 campos andam
        // juntos (mediana sem escopo/n não é auditável). Nulos quando o item
        // não casou ou a região ainda não tinha base.
        tipico_mediana: i.tipicoNaCompra?.mediana ?? null,
        tipico_unidade_base: i.tipicoNaCompra?.unidadeBase ?? null,
        tipico_escopo: i.tipicoNaCompra?.escopo ?? null,
        tipico_n_observacoes: i.tipicoNaCompra?.nObservacoes ?? null,
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
      p_desconto_total: dados.total?.desconto ?? null,
      p_valor_pago: dados.total?.pago ?? null,
      p_sobrescrever_processado: opcoes?.sobrescreverProcessado ?? false,
      p_chave_hash: dados.chaveHash ?? null,
      p_qr_payload: dados.qrPayloadSaneado ?? null,
    });
    if (r.error) falhar('processamento transacional do cupom', r.error);
    // A RPC devolve false quando as observações foram RETIDAS pelo dedup
    // (chave já publicada por outra conta) — o chamador pula o recálculo.
    return { poolPublicado: r.data === true };
  }

  async marcarFalha(cupomId: string, motivo?: string): Promise<void> {
    const r = await this.db
      .from('cupom')
      .update({
        status: 'falha',
        // Diagnóstico (C10.2): sem o motivo persistido, a falha permanente só
        // existia no console do servidor — impossível saber POR QUE um cupom
        // não leu. Truncado: é campo de operação, não de conteúdo.
        falha_motivo: motivo ? motivo.slice(0, 500) : null,
        atualizado_em: new Date().toISOString(),
      })
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

  async casarPorDescricao(sugestao: SugestaoProduto): Promise<string> {
    const porDescricao = () =>
      this.db
        .from('produto_canonico')
        .select('id')
        .is('ean', null)
        .eq('descricao_normalizada', sugestao.descricaoNormalizada)
        .eq('unidade_base', sugestao.unidadeBase);

    const existente = await porDescricao().maybeSingle();
    if (existente.error) falhar('consulta de produto por descrição', existente.error);
    if (existente.data) return existente.data.id;

    const inserido = await this.db
      .from('produto_canonico')
      .insert({
        ean: null,
        descricao_normalizada: sugestao.descricaoNormalizada,
        unidade_base: sugestao.unidadeBase,
      })
      .select('id')
      .single();

    // Corrida coberta pelo índice único parcial (descricao, unidade) WHERE ean IS NULL.
    if (inserido.error?.code === COD_UNIQUE_VIOLATION) {
      const r = await porDescricao().single();
      if (r.error) falhar('reconsulta de produto após conflito de descrição', r.error);
      return r.data.id;
    }
    if (inserido.error) falhar('inserção de produto canônico sem EAN', inserido.error);
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
    return paraResumoProduto(r.data);
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

  // ───────────────────────── FonteBuscaProdutos (C4.4) ────────────────

  /**
   * Linhas do recorte geo, das mais observadas para as menos. A ordenação vai no
   * BANCO de propósito: é ela que faz o corte pelo `limite` significar "os mais
   * observados da região" (o ranking de populares) em vez de "os que o Postgres
   * devolveu primeiro". O nível `loja` não entra porque os `escopoIds` recebidos
   * são só município/UF — quem deriva é o serviço.
   */
  async estatisticasNoEscopo(filtro: FiltroBuscaProdutos): Promise<PrecoEstatistica[]> {
    if (filtro.escopoIds.length === 0) return [];
    let consulta = this.db
      .from('preco_estatistica')
      .select('*')
      .in('escopo_id', [...filtro.escopoIds]);
    if (filtro.produtoCanonicoIds) {
      if (filtro.produtoCanonicoIds.length === 0) return [];
      consulta = consulta.in('produto_canonico_id', [...filtro.produtoCanonicoIds]);
    }
    const r = await consulta.order('n_observacoes', { ascending: false }).limit(filtro.limite);
    if (r.error) falhar('busca de produtos no escopo (C4.4)', r.error);
    return (r.data ?? []).map(paraEstatistica);
  }

  async resumosProdutos(produtoCanonicoIds: readonly string[]): Promise<ProdutoResumo[]> {
    if (produtoCanonicoIds.length === 0) return [];
    const r = await this.db
      .from('produto_canonico')
      .select('id, nome_exibicao, marca, categoria, imagem_url, unidade_base')
      .in('id', [...produtoCanonicoIds]);
    if (r.error) falhar('carga de resumos de produto (C4.4)', r.error);
    return (r.data ?? []).map(paraResumoProduto);
  }

  // ───────────────────────── FonteObservacoes (C3) ────────────────────

  /**
   * Produtos a recalcular. Sem `desde` → varre o catálogo inteiro (recálculo
   * completo, paginado). Com `desde` → drena a FILA `produto_recalculo_pendente`,
   * alimentada por trigger a cada inserção no pool.
   *
   * Por que a fila e não `observacao_preco.criado_em`: `criado_em` é granular ao
   * DIA (anti-remontagem de cesta, docs/04), logo não serve a uma janela de
   * minutos; e varrer o pool por timestamp custa caro conforme ele cresce.
   */
  async listarProdutosComObservacoes(desde?: string): Promise<string[]> {
    if (desde) {
      const pendentes = await paginar<{ produto_canonico_id: string }>(
        'fila de recálculo pendente',
        (de, ate) =>
          this.db
            .from('produto_recalculo_pendente')
            .select('produto_canonico_id')
            .gte('marcado_em', desde)
            .order('marcado_em', { ascending: true })
            .range(de, ate),
      );
      return [...new Set(pendentes.map((p) => p.produto_canonico_id))];
    }

    // Recálculo COMPLETO: varre o CATÁLOGO, não o pool. São os mesmos produtos
    // (o pool tem FK para `produto_canonico`), mas o catálogo tem uma linha por
    // produto em vez de uma por observação — ler milhões de ids só para
    // deduplicá-los na memória do Node era o caminho caro. Produto sem
    // observação custa uma consulta vazia e produz zero linhas.
    const todos = await paginar<{ id: string }>('listagem de produtos do catálogo', (de, ate) =>
      this.db.from('produto_canonico').select('id').order('id', { ascending: true }).range(de, ate),
    );
    return todos.map((p) => p.id);
  }

  /** Marca os produtos como recalculados (remove da fila). Best-effort. */
  async limparPendenciaRecalculo(produtoCanonicoIds: readonly string[]): Promise<void> {
    if (produtoCanonicoIds.length === 0) return;
    const r = await this.db
      .from('produto_recalculo_pendente')
      .delete()
      .in('produto_canonico_id', [...produtoCanonicoIds]);
    if (r.error) falhar('limpeza da fila de recálculo', r.error);
  }

  async observacoesDoProduto(
    produtoCanonicoId: string,
    desdeObservadoEm?: string,
  ): Promise<ObservacaoParaAgregacao[]> {
    const linhas = await paginar<LinhaObservacaoBruta>(
      'carga de observações do produto',
      (de, ate) => {
        let q = this.db
          .from('observacao_preco')
          .select(
            'produto_canonico_id, unidade_base, loja_cnpj, municipio, uf, preco_normalizado, em_promocao, observado_em',
          )
          .eq('produto_canonico_id', produtoCanonicoId);
        // A janela do decaimento aplicada NO BANCO: o que está fora dela seria
        // descartado por `agregar()` de qualquer forma — trazer é desperdício e,
        // pior, empurra o que importa para fora do teto de linhas.
        if (desdeObservadoEm) q = q.gte('observado_em', desdeObservadoEm);
        // DESC: se o teto de segurança cortar, corta o MAIS ANTIGO (menor peso).
        return q.order('observado_em', { ascending: false }).range(de, ate);
      },
      MAX_OBSERVACOES_AGREGACAO,
    );
    return linhas.map((l) => ({
      produtoCanonicoId: l.produto_canonico_id,
      unidadeBase: l.unidade_base,
      lojaCnpj: l.loja_cnpj,
      ...(l.municipio ? { municipio: l.municipio } : {}),
      ...(l.uf ? { uf: l.uf } : {}),
      precoNormalizado: Number(l.preco_normalizado),
      emPromocao: l.em_promocao,
      observadoEm: l.observado_em,
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
    return (r.data ?? []).map(paraEstatistica);
  }

  // ───────────────────────── FonteComparacaoLojas (C12.1) ─────────────

  async estatisticasDeLojasPorProdutos(
    produtoCanonicoIds: readonly string[],
  ): Promise<EstatisticaLojaLinha[]> {
    if (produtoCanonicoIds.length === 0) return [];
    const r = await this.db
      .from('preco_estatistica')
      .select('produto_canonico_id, escopo_id, mediana, menor_promocional, n_observacoes')
      .eq('escopo', 'loja')
      .in('produto_canonico_id', [...produtoCanonicoIds]);
    if (r.error) falhar('consulta de estatísticas por loja (C12.1)', r.error);
    const linhas = r.data ?? [];
    if (linhas.length === 0) return [];

    // Referência pública das lojas (nome/geo) numa segunda leitura em lote — a
    // normalização da chave de município fica no serviço (uma fonte só).
    const cnpjs = [...new Set(linhas.map((l) => l.escopo_id as string))];
    const rl = await this.db
      .from('loja')
      .select('cnpj, nome_fantasia, razao_social, municipio, uf')
      .in('cnpj', cnpjs);
    if (rl.error) falhar('consulta de lojas da comparação (C12.1)', rl.error);
    const lojas = new Map((rl.data ?? []).map((l) => [l.cnpj as string, l]));

    return linhas.map((e) => {
      const loja = lojas.get(e.escopo_id as string);
      const nome = (loja?.nome_fantasia ?? loja?.razao_social) as string | undefined;
      const mediana = num(e.mediana);
      const menorPromocional = num(e.menor_promocional);
      return {
        produtoCanonicoId: e.produto_canonico_id as string,
        lojaCnpj: e.escopo_id as string,
        ...(nome ? { nomeLoja: nome } : {}),
        ...(loja?.municipio ? { municipioLoja: loja.municipio as string } : {}),
        ...(loja?.uf ? { ufLoja: loja.uf as string } : {}),
        ...(mediana != null ? { mediana } : {}),
        ...(menorPromocional != null ? { menorPromocional } : {}),
        nObservacoes: Number(e.n_observacoes),
      };
    });
  }

  // ───────────────────────── FonteDeltaSync (C4.2) ────────────────────

  async deltaEstatisticas(filtro: FiltroDeltaSync): Promise<LinhaDelta[]> {
    let consulta = this.db.from('preco_estatistica').select('*');
    if (filtro.desde) {
      // Keyset: (atualizado_em, seq) > (cursor.atualizadoEm, cursor.seq).
      // O `or` do PostgREST vira exatamente esse predicado — e é o que impede o
      // corte no limite de pular o resto de um lote com timestamp idêntico.
      const { atualizadoEm, seq } = filtro.desde;
      // Timestamp entre aspas: o valor é interpolado numa expressão PostgREST,
      // e aspas evitam que qualquer caractere dele seja lido como sintaxe.
      const ts = `"${atualizadoEm.replace(/"/g, '')}"`;
      consulta = consulta.or(
        `atualizado_em.gt.${ts},and(atualizado_em.eq.${ts},seq.gt.${Number(seq)})`,
      );
    }
    if (filtro.escopoIds && filtro.escopoIds.length > 0) {
      consulta = consulta.in('escopo_id', filtro.escopoIds);
    }
    if (filtro.produtoCanonicoIds && filtro.produtoCanonicoIds.length > 0) {
      consulta = consulta.in('produto_canonico_id', filtro.produtoCanonicoIds);
    }
    const r = await consulta
      .order('atualizado_em', { ascending: true })
      .order('seq', { ascending: true })
      .limit(filtro.limite);
    if (r.error) falhar('leitura do delta de estatísticas', r.error);
    return (r.data ?? []).map((e) => ({
      seq: Number(e.seq),
      estatistica: paraEstatistica(e),
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

  async listarProdutosParaEnriquecer(limite: number): Promise<AlvoEnriquecimento[]> {
    const r = await this.db
      .from('produto_canonico')
      .select('id, ean')
      .not('ean', 'is', null)
      .is('nome_exibicao', null)
      .order('criado_em', { ascending: true })
      .limit(limite);
    if (r.error) falhar('listagem de produtos para enriquecer (C11.5)', r.error);
    return (r.data ?? []).map((p) => ({
      produtoCanonicoId: p.id as string,
      ean: p.ean as string,
    }));
  }

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

  // ───────────────────────── RepositorioDenuncia (C12.5) ──────────────

  async existeProduto(produtoCanonicoId: string): Promise<boolean> {
    const r = await this.db
      .from('produto_canonico')
      .select('id')
      .eq('id', produtoCanonicoId)
      .maybeSingle();
    if (r.error) falhar('checagem de produto para denúncia', r.error);
    return r.data != null;
  }

  async criarDenuncia(dados: DenunciaNova): Promise<DenunciaRegistrada> {
    const r = await this.db
      .from('denuncia_preco')
      .insert({
        usuario_id: dados.usuarioId,
        produto_canonico_id: dados.produtoCanonicoId,
        motivo: dados.motivo,
        municipio: dados.municipio ?? null,
        uf: dados.uf ?? null,
        comentario: dados.comentario ?? null,
      })
      .select('id')
      .single();

    // 23505 = índice único parcial (usuário, produto) com uma denúncia ABERTA.
    // Não é erro para quem usa o app: já estava registrado. Devolvemos a aberta.
    if (r.error?.code === COD_UNIQUE_VIOLATION) {
      const aberta = await this.db
        .from('denuncia_preco')
        .select('id')
        .eq('usuario_id', dados.usuarioId)
        .eq('produto_canonico_id', dados.produtoCanonicoId)
        .eq('status', 'pendente')
        .maybeSingle();
      if (aberta.error) falhar('carga de denúncia já aberta', aberta.error);
      if (aberta.data) return { id: aberta.data.id as string, jaRegistrada: true };
    }
    if (r.error) falhar('registro de denúncia de preço', r.error);
    return { id: r.data.id as string, jaRegistrada: false };
  }

  async listarDenunciasPendentes(limite?: number): Promise<DenunciaCuradoria[]> {
    // NOTA: o select NÃO inclui `usuario_id` — a curadoria decide pelo conteúdo,
    // e o autor não pode vazar para fora do lado privado (docs/04).
    let consulta = this.db
      .from('denuncia_preco')
      .select('id, produto_canonico_id, motivo, municipio, uf, comentario, status, criado_em')
      .eq('status', 'pendente')
      .order('criado_em', { ascending: true });
    if (limite !== undefined) consulta = consulta.limit(limite);
    const r = await consulta;
    if (r.error) falhar('listagem da fila de denúncias', r.error);

    const linhas = r.data ?? [];
    // Volume por produto: o sinal forte para priorizar a fila.
    const abertas = new Map<string, number>();
    for (const d of linhas) {
      const pid = d.produto_canonico_id as string;
      abertas.set(pid, (abertas.get(pid) ?? 0) + 1);
    }

    return linhas.map((d) => ({
      id: d.id as string,
      produtoCanonicoId: d.produto_canonico_id as string,
      motivo: d.motivo as MotivoDenuncia,
      ...(d.municipio ? { municipio: d.municipio as string } : {}),
      ...(d.uf ? { uf: d.uf as string } : {}),
      ...(d.comentario ? { comentario: d.comentario as string } : {}),
      status: d.status as StatusModeracao,
      criadoEm: d.criado_em as string,
      abertasNoProduto: abertas.get(d.produto_canonico_id as string) ?? 1,
    }));
  }

  async decidirDenuncia(id: string, procedente: boolean, resolucao?: string): Promise<boolean> {
    const r = await this.db
      .from('denuncia_preco')
      .update({
        status: procedente ? 'aprovado' : 'rejeitado',
        resolucao: resolucao ?? null,
        decidido_em: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pendente')
      .select('id')
      .maybeSingle();
    if (r.error) falhar('decisão de denúncia', r.error);
    return r.data != null;
  }
}
