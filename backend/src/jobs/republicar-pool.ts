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
 * NÃO congela o típico da compra (`TipicoNaCompra`), e isso é deliberado: o
 * cupom aqui é antigo, e gravar a mediana de HOJE como se fosse a da época
 * inventaria um passado que nunca existiu — o oposto do motivo de o snapshot
 * existir. Esses itens ficam sem baseline para sempre, o que é a resposta
 * honesta. O caminho normal (`ProcessadorCupom.finalizar`) é quem congela.
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
import { sanitizarErroInesperado } from '../observabilidade/sanitizar';
import { RepositorioSupabase } from '../persistencia/repositorio-supabase';
import { hashChavePool } from '../persistencia/tipos';
import { criarClienteSupabase } from '../persistencia/supabase';
import type { RepositorioCupom } from '../persistencia/tipos';
import { criarCifra } from '../seguranca/cifra';

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
        // O código interno da loja já sobreviveu até aqui (item_cupom); sem
        // repassá-lo, um cupom antigo perderia o dado no backfill mesmo tendo
        // sido persistido — reconstruir a nota tem que ser fiel ao original.
        ...(i.codigoLoja ? { codigoLoja: i.codigoLoja } : {}),
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
  // C9.2.2 (b6) — este job LÊ chave_acesso/descricao de item (para reconstruir a
  // nota a partir do lado privado) e volta a escrevê-los via `marcarProcessado`
  // — precisa da cifra ativa de verdade (CIFRA_CHAVE_ATUAL configurada), ao
  // contrário dos jobs que só tocam o pool anônimo.
  const repo = new RepositorioSupabase(
    db,
    criarCifra({ chaveAtual: config.cifraChaveAtual, chaveAnterior: config.cifraChaveAnterior }),
  );
  // As MESMAS fontes de casamento da ingestão (C3.6.1): um backfill que resolve
  // produto por um critério diferente do caminho normal produziria um pool
  // internamente inconsistente — o pior tipo de dado, porque parece certo.
  const anonimizador = new AnonimizadorReal(repo, undefined, {
    mapaCodigoLoja: repo,
    aliasTexto: repo,
  });
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
    // Catch-all do job — com pilha (C10.4), ver nota em `recalculo-estatistica`.
    logDeJob('republicar-pool').error({ erro: sanitizarErroInesperado(erro) }, 'Job falhou');
    process.exitCode = 1;
  });
}
