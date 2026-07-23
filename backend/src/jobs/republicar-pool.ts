/**
 * Backfill do pool compartilhado — republica cupons `processado` cujos itens
 * nunca casaram com produto canônico.
 *
 * Por que existe: até o casamento por DESCRIÇÃO (itens sem EAN) entrar, cupons
 * de portais que só mostram código interno (ex.: RJ/ENCAT) eram processados com
 * TODOS os itens fora do pool — histórico privado ok, estatística vazia. O
 * reprocessamento retroativo (C2.5) não os alcança (só alveja não-`processado`,
 * e o RJ exige o HTML vindo do app). Este job reconstrói a nota a partir do
 * LADO PRIVADO (`item_cupom` + `cupom` + `loja`) e a repassa pelo caminho
 * normal: anonimização (gate C1.4) → `marcarProcessado` → recálculo (C3).
 *
 * Anti-duplicação: o pool é append-only e sem vínculo com o cupom, então só é
 * elegível o cupom em que NENHUM item tem canônico — nesse caso o processamento
 * original comprovadamente não publicou nada. Isso também torna o job
 * idempotente: após republicar, os itens ganham canônico e saem da elegibilidade.
 *
 * Execução manual (one-off, workspace @barganha/backend):
 *   npm run job:republicar
 */

import { fileURLToPath } from 'node:url';

import type { ItemEstruturado, NotaEstruturada } from '@barganha/shared';

import type { Anonimizador } from '../anonimizacao/anonimizador';
import { Anonimizador as AnonimizadorReal } from '../anonimizacao/anonimizador';
import { type ConfigBackend, lerConfig } from '../config/env';
import { PipelineEstatistica } from '../estatistica/pipeline';
import { logDeJob } from '../observabilidade/log';
import { sanitizarErro } from '../observabilidade/sanitizar';
import { RepositorioSupabase } from '../persistencia/repositorio-supabase';
import { hashChavePool } from '../persistencia/tipos';
import { criarClienteSupabase } from '../persistencia/supabase';
import type { RepositorioCupom } from '../persistencia/tipos';

export interface ResumoRepublicacao {
  cuponsExaminados: number;
  cuponsRepublicados: number;
  observacoesPublicadas: number;
  produtosRecalculados: number;
}

/**
 * Núcleo testável: varre os `processado`, republica os elegíveis e dispara o
 * recálculo dos produtos afetados. Só usa as portas existentes do repositório.
 */
export async function republicarPool(
  repo: RepositorioCupom,
  anonimizador: Pick<Anonimizador, 'anonimizar'>,
  recalcularProduto: (produtoCanonicoId: string) => Promise<unknown>,
  opcoes: { limite?: number } = {},
): Promise<ResumoRepublicacao> {
  const ids = await repo.listarParaReprocessar({
    status: ['processado'],
    ...(opcoes.limite !== undefined ? { limite: opcoes.limite } : {}),
  });

  const produtos = new Set<string>();
  let republicados = 0;
  let publicadas = 0;

  for (const cupomId of ids) {
    const cupom = await repo.obterParaProcessamento(cupomId);
    if (!cupom) continue;
    const visao = await repo.obterDoUsuario(cupomId, cupom.usuarioId);
    if (!visao?.loja || !visao.emitidoEm || visao.itens.length === 0) continue;
    // Guarda anti-duplicação (ver cabeçalho): algum canônico ⇒ o processamento
    // original já pôde publicar — não dá para republicar sem duplicar o pool.
    if (visao.itens.some((i) => i.produtoCanonicoId)) continue;

    const uf = visao.uf ?? cupom.uf;
    const nota: NotaEstruturada = {
      loja: {
        cnpj: visao.loja.cnpj,
        razaoSocial: visao.loja.razaoSocial ?? '',
        // O lado privado não guarda o endereço; o upsert da loja preserva o já salvo.
        endereco: '',
        municipio: visao.loja.municipio ?? '',
        uf: visao.loja.uf ?? uf ?? '',
      },
      emitidoEm: visao.emitidoEm,
      itens: visao.itens.map((i): ItemEstruturado => ({
        descricao: i.descricaoOriginal,
        ...(i.ean ? { ean: i.ean } : {}),
        quantidade: i.quantidade,
        unidade: i.unidade,
        valorUnitario: i.valorUnitario,
        valorTotal: i.valorTotal,
        ...(i.desconto != null ? { desconto: i.desconto } : {}),
      })),
    };

    const resultado = await anonimizador.anonimizar(
      nota,
      {
        usuarioId: cupom.usuarioId,
        cupomId: cupom.id,
        ...(cupom.chaveAcesso ? { chaveAcesso: cupom.chaveAcesso } : {}),
      },
      uf,
    );
    if (resultado.observacoes.length === 0) continue;

    const { poolPublicado } = await repo.marcarProcessado(
      cupom.id,
      {
        loja: resultado.loja,
        emitidoEm: resultado.emitidoEm,
        uf: uf ?? resultado.loja.uf,
        itensPrivados: resultado.itensPrivados,
        observacoes: resultado.observacoes,
        // C9.2.1 — o dedup global vale também aqui: se OUTRA conta com o mesmo
        // cupom já publicou (na captura ou numa republicação anterior), esta
        // republicação atualiza o privado mas não duplica o pool.
        ...(cupom.chaveAcesso ? { chaveHash: hashChavePool(cupom.chaveAcesso) } : {}),
      },
      // Backfill reescreve um cupom JÁ `processado` de propósito — a trava
      // anti-corrida é pulada aqui; a anti-duplicação é a guarda acima
      // (nenhum item com canônico ⇒ nada foi publicado antes).
      { sobrescreverProcessado: true },
    );
    republicados++;
    if (poolPublicado) {
      publicadas += resultado.observacoes.length;
      for (const o of resultado.observacoes) produtos.add(o.produtoCanonicoId);
    }
  }

  for (const id of produtos) await recalcularProduto(id);

  return {
    cuponsExaminados: ids.length,
    cuponsRepublicados: republicados,
    observacoesPublicadas: publicadas,
    produtosRecalculados: produtos.size,
  };
}

/** Monta as peças reais (Supabase), roda a republicação e loga um resumo. */
export async function rodarJobRepublicacao(
  config: ConfigBackend = lerConfig(),
): Promise<ResumoRepublicacao> {
  const db = criarClienteSupabase(config.supabaseUrl, config.supabaseServiceRoleKey);
  const repo = new RepositorioSupabase(db);
  const anonimizador = new AnonimizadorReal(repo);
  const pipeline = new PipelineEstatistica(repo, repo);

  const inicio = Date.now();
  const resumo = await republicarPool(repo, anonimizador, (id) => pipeline.recalcularProduto(id));
  logDeJob('republicar-pool').info(
    {
      cuponsRepublicados: resumo.cuponsRepublicados,
      cuponsExaminados: resumo.cuponsExaminados,
      observacoesPublicadas: resumo.observacoesPublicadas,
      produtosRecalculados: resumo.produtosRecalculados,
      duracaoMs: Date.now() - inicio,
    },
    'Republicação do pool concluída',
  );
  return resumo;
}

// Executado direto (não quando importado por um teste): roda e propaga o código
// de saída para o operador detectar falha.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rodarJobRepublicacao().catch((erro) => {
    logDeJob('republicar-pool').error({ erro: sanitizarErro(erro) }, 'Job falhou');
    process.exitCode = 1;
  });
}
