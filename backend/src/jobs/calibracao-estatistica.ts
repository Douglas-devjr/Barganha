/**
 * C3 — Job de MEDIÇÃO da calibração do motor de agregação (docs/06).
 *
 * Carrega o pool real (`observacao_preco`), roda as três medições de
 * `estatistica/calibracao.ts` e imprime um relatório comparando o valor ATUAL
 * de cada parâmetro com o RECOMENDADO. Só mede — não escreve no banco, não
 * troca `DECAIMENTO` nem `MIN_OBSERVACOES_FALLBACK` sozinho. Aplicar uma
 * recomendação é decisão humana, num commit separado (mesma filosofia do
 * `job:cobertura-tipico`).
 *
 * Enquanto o pool do beta for raso, o resultado honesto é "dados
 * insuficientes" — o job não falha por isso, só relata.
 *
 * Execução manual (one-off, workspace @barganha/backend):
 *   npm run job:calibracao
 */

import { fileURLToPath } from 'node:url';

import { DECAIMENTO } from '../estatistica/agregacao';
import {
  agruparParaCalibracao,
  calibrarFatorCerco,
  calibrarMeiaVida,
  calibrarMinimoObservacoes,
  type ResultadoCerco,
  type ResultadoMeiaVida,
  type ResultadoMinimoPorNivel,
} from '../estatistica/calibracao';
import type { ObservacaoParaAgregacao } from '../estatistica/tipos';

import { lerConfig } from '../config/env';
import { logDeJob } from '../observabilidade/log';
import { sanitizarErroInesperado } from '../observabilidade/sanitizar';
import { RepositorioSupabase } from '../persistencia/repositorio-supabase';
import { criarClienteSupabase } from '../persistencia/supabase';
import { criarCifra } from '../seguranca/cifra';

const DIA_MS = 86_400_000;

export interface ResumoCalibracao {
  meiaVida: ResultadoMeiaVida;
  fatorCerco: ResultadoCerco;
  minimoPorNivel: readonly ResultadoMinimoPorNivel[];
}

// ─────────────────────────────── Wiring (Supabase) ────────────────────────

type FonteObservacoesMinima = Pick<
  RepositorioSupabase,
  'listarProdutosComObservacoes' | 'observacoesDoProduto'
>;

/**
 * Início da janela do decaimento (ISO) — o MESMO recorte que `pipeline.ts`
 * aplica no recálculo real. Sem isso, a carga traria histórico que
 * `agregar()` já descartaria de qualquer forma, só para pesar no relatório.
 */
function inicioDaJanela(referencia: Date): string {
  return new Date(referencia.getTime() - DECAIMENTO.maxIdadeDias * DIA_MS).toISOString();
}

/**
 * Varre o catálogo inteiro (produto por produto, como `recalcularTodos`) e
 * junta as observações num único pool para agrupar por (produto × unidade ×
 * escopo). É uma ferramenta de medição rodada manualmente, não um caminho de
 * produção — varrer tudo é aceitável na v1 (mesma escolha de
 * `job:cobertura-tipico`).
 */
async function carregarObservacoes(
  fonte: FonteObservacoesMinima,
  referencia: Date,
): Promise<ObservacaoParaAgregacao[]> {
  const desde = inicioDaJanela(referencia);
  const produtoIds = await fonte.listarProdutosComObservacoes();
  const todas: ObservacaoParaAgregacao[] = [];
  for (const id of produtoIds) {
    todas.push(...(await fonte.observacoesDoProduto(id, desde)));
  }
  return todas;
}

// ────────────────────────────────── Relatório ─────────────────────────────

function imprimirRelatorio(resumo: ResumoCalibracao): void {
  console.log('── Motor de agregação: calibração medida contra o pool real ──');

  console.log('\nMeia-vida do decaimento (dias):');
  console.log(`  atual: ${resumo.meiaVida.valorAtual} · ${resumo.meiaVida.detalhe}`);

  console.log('\nFator do cerco de promoção (k em p25 − k·IQR):');
  console.log(`  atual: ${resumo.fatorCerco.valorAtual} · ${resumo.fatorCerco.detalhe}`);

  console.log('\nMínimo de observações por nível de escopo:');
  for (const r of resumo.minimoPorNivel) {
    console.log(`  ${r.escopo}: atual ${r.valorAtual} · ${r.detalhe}`);
  }

  console.log(
    '\nApenas medição — aplicar qualquer recomendação acima é decisão humana, ' +
      'num commit separado (docs/06).',
  );
}

// ────────────────────────────────── Execução ──────────────────────────────

/** Núcleo testável: recebe o pool já carregado e roda as três medições. */
export function calibrar(
  observacoes: readonly ObservacaoParaAgregacao[],
  referencia: Date,
): ResumoCalibracao {
  const grupos = agruparParaCalibracao(observacoes);
  return {
    meiaVida: calibrarMeiaVida(grupos, { referencia }),
    fatorCerco: calibrarFatorCerco(grupos, { referencia }),
    minimoPorNivel: calibrarMinimoObservacoes(grupos, { referencia }),
  };
}

/** Monta as peças reais (Supabase), carrega o pool, mede e loga/imprime o resumo. */
export async function rodarJobCalibracao(): Promise<ResumoCalibracao> {
  const log = logDeJob('calibracao-estatistica');
  const config = lerConfig();
  const db = criarClienteSupabase(config.supabaseUrl, config.supabaseServiceRoleKey);
  // C9.2.2 (b6) — este job só lê `observacao_preco` (pool anônimo, nunca cifrado)
  // via RepositorioEstatistica; nunca toca chave_acesso/descricao de item. A
  // cifra sem chave configurada não afeta este caminho (falha só ao ser usada).
  const repo = new RepositorioSupabase(db, criarCifra({ chaveAtual: config.cifraChaveAtual }));
  const referencia = new Date();

  const observacoes = await carregarObservacoes(repo, referencia);
  const resumo = calibrar(observacoes, referencia);

  log.info(
    {
      action: 'calibracao_estatistica.concluido',
      observacoesCarregadas: observacoes.length,
      meiaVida: {
        valorAtual: resumo.meiaVida.valorAtual,
        valorRecomendado: resumo.meiaVida.valorRecomendado,
        amostrasAvaliadas: resumo.meiaVida.amostrasAvaliadas,
      },
      fatorCerco: {
        valorAtual: resumo.fatorCerco.valorAtual,
        valorRecomendado: resumo.fatorCerco.valorRecomendado,
        amostrasAvaliadas: resumo.fatorCerco.amostrasAvaliadas,
      },
      minimoPorNivel: resumo.minimoPorNivel.map((r) => ({
        escopo: r.escopo,
        valorAtual: r.valorAtual,
        valorRecomendado: r.valorRecomendado,
        amostrasAvaliadas: r.amostrasAvaliadas,
      })),
    },
    'Medição de calibração da agregação concluída',
  );

  // Rodado manualmente por humano decidindo se/como recalibrar — vale um
  // console.log legível além do log estruturado (mesmo padrão de cobertura-tipico).
  imprimirRelatorio(resumo);

  return resumo;
}

// Executado direto (não quando importado por um teste): roda e propaga o
// código de saída para o operador detectar falha.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rodarJobCalibracao().catch((erro) => {
    // Catch-all do job — com pilha (C10.4), ver nota em `recalculo-estatistica`.
    logDeJob('calibracao-estatistica').fatal(
      { erro: sanitizarErroInesperado(erro) },
      'Job de calibração falhou',
    );
    process.exitCode = 1;
  });
}
