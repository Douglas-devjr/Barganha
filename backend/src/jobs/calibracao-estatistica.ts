/**
 * C3 — Job de MEDIÇÃO da calibração do motor de agregação (docs/06).
 *
 * Carrega o pool real (`observacao_preco`), roda as quatro medições de
 * `estatistica/calibracao.ts` e imprime um relatório comparando o valor ATUAL
 * de cada parâmetro com o RECOMENDADO. Só mede — não escreve no banco, não
 * troca `DECAIMENTO` nem `MIN_OBSERVACOES_FALLBACK` sozinho. Aplicar uma
 * recomendação é decisão humana, num commit separado (mesma filosofia do
 * `job:cobertura-tipico`).
 *
 * Enquanto o pool do beta for raso, o resultado honesto é "dados
 * insuficientes" — o job não falha por isso, só relata.
 *
 * Rodado por scheduler externo (GitHub Actions cron em
 * `.github/workflows/calibracao-estatistica.yml`) e também à mão (workspace
 * @barganha/backend):
 *   npm run job:calibracao
 *
 * Por que o cron existe: sem ele, o destravamento desta medição dependeria de
 * alguém LEMBRAR de rodar o job depois que o beta engordasse — e o pool não
 * avisa quando fica fundo. O cron é barato (mensal) e transforma "espere e
 * lembre" em "seremos avisados". Ele continua não aplicando nada: quando uma
 * medição pedir um valor diferente do vigente, o job manda um aviso ao webhook
 * e para por aí. Trocar a constante é decisão humana, num commit separado.
 */

import { fileURLToPath } from 'node:url';

import { DECAIMENTO } from '../estatistica/agregacao';
import {
  agruparParaCalibracao,
  calibrarFatorCerco,
  calibrarMeiaVida,
  calibrarMinimoObservacoes,
  calibrarZonaMorta,
  type ResultadoCerco,
  type ResultadoMeiaVida,
  type ResultadoMinimoPorNivel,
  type ResultadoZonaMorta,
} from '../estatistica/calibracao';
import type { ObservacaoParaAgregacao } from '../estatistica/tipos';

import { lerConfig } from '../config/env';
import { enviarAlerta } from '../observabilidade/alerta-parsing';
import { logDeJob } from '../observabilidade/log';
import { sanitizarErro, sanitizarErroInesperado } from '../observabilidade/sanitizar';
import { RepositorioSupabase } from '../persistencia/repositorio-supabase';
import { criarClienteSupabase } from '../persistencia/supabase';
import { criarCifra } from '../seguranca/cifra';

const DIA_MS = 86_400_000;

export interface ResumoCalibracao {
  meiaVida: ResultadoMeiaVida;
  fatorCerco: ResultadoCerco;
  minimoPorNivel: readonly ResultadoMinimoPorNivel[];
  /** C3.6 — a única medição do VEREDITO, não da agregação. */
  zonaMorta: readonly ResultadoZonaMorta[];
}

// ─────────────────────────────── Wiring (Supabase) ────────────────────────

type FonteObservacoesMinima = Pick<
  RepositorioSupabase,
  'listarProdutosComObservacoes' | 'observacoesDoProduto' | 'resumosProdutos'
>;

/** Lote da carga de categorias — `.in(...)` vira query string, e ela tem teto. */
const LOTE_RESUMOS = 200;

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

/**
 * `produtoCanonicoId` → categoria, só para a medição da zona morta (C3.6). Os
 * ids saem do pool já carregado (não de uma segunda varredura do catálogo): quem
 * não tem observação não influencia medição nenhuma.
 *
 * Produto sem categoria simplesmente não entra no mapa — a medição o trata como
 * família `outros`, que é exatamente como o app o trata na gôndola.
 */
async function carregarCategorias(
  fonte: FonteObservacoesMinima,
  observacoes: readonly ObservacaoParaAgregacao[],
): Promise<Map<string, string>> {
  const ids = [...new Set(observacoes.map((o) => o.produtoCanonicoId))];
  const mapa = new Map<string, string>();
  for (let i = 0; i < ids.length; i += LOTE_RESUMOS) {
    const resumos = await fonte.resumosProdutos(ids.slice(i, i + LOTE_RESUMOS));
    for (const r of resumos) {
      if (r.categoria) mapa.set(r.produtoCanonicoId, r.categoria);
    }
  }
  return mapa;
}

// ────────────────────────────────── Relatório ─────────────────────────────

/** Zona morta é fração da mediana; ler "0.008" a olho nu não ajuda ninguém. */
function pctValor(fracao: number): string {
  return `${(fracao * 100).toFixed(1)}%`;
}

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

  console.log('\nZona morta do veredito, por família de categoria (C3.6):');
  for (const r of resumo.zonaMorta) {
    console.log(`  ${r.familia}`);
    console.log(`    base : atual ${pctValor(r.base.valorAtual)} · ${r.base.detalhe}`);
    console.log(
      `    deriva/mês: atual ${pctValor(r.derivaMensal.valorAtual)} · ${r.derivaMensal.detalhe}`,
    );
  }

  console.log(
    '\nApenas medição — aplicar qualquer recomendação acima é decisão humana, ' +
      'num commit separado (docs/06).',
  );
}

// ──────────────────── Aviso: a medição pediu outro valor ──────────────────

/** Um parâmetro que a medição já consegue avaliar E cujo valor vigente contraria. */
export interface DivergenciaCalibracao {
  parametro: string;
  valorAtual: number;
  valorRecomendado: number;
  amostrasAvaliadas: number;
  detalhe: string;
}

/**
 * Filtra o resumo para o que EXIGE uma decisão humana: medição com base
 * suficiente (`valorRecomendado` presente) e recomendação diferente do valor
 * vigente.
 *
 * Medição que CONFIRMA o valor atual não entra de propósito. Ela é a notícia
 * boa — o chute virou número medido — mas não pede ação nenhuma, e um aviso
 * mensal repetindo "continua 30 dias" é exatamente o alerta que se aprende a
 * ignorar. Ela fica no relatório e no log estruturado, que é onde se procura
 * quando a pergunta é "já dá para medir?".
 *
 * Sem estado de propósito: enquanto o humano não decidir (aplicar ou recusar
 * com um comentário), o aviso volta no mês seguinte. Uma decisão devida que
 * silencia sozinha é uma decisão esquecida.
 */
export function divergenciasDeCalibracao(resumo: ResumoCalibracao): DivergenciaCalibracao[] {
  const divergencias: DivergenciaCalibracao[] = [];
  const considerar = (parametro: string, r: RecomendacaoComparavel): void => {
    if (r.valorRecomendado === undefined || r.valorRecomendado === r.valorAtual) return;
    divergencias.push({
      parametro,
      valorAtual: r.valorAtual,
      valorRecomendado: r.valorRecomendado,
      amostrasAvaliadas: r.amostrasAvaliadas,
      detalhe: r.detalhe,
    });
  };

  considerar('meia-vida do decaimento (dias)', resumo.meiaVida);
  considerar('fator do cerco de promoção (k)', resumo.fatorCerco);
  for (const r of resumo.minimoPorNivel) considerar(`mínimo de observações — ${r.escopo}`, r);
  // A zona morta é do VEREDITO, não da agregação, mas quem decide é o mesmo
  // humano e o gatilho é o mesmo (pool fundo o bastante) — deixá-la fora faria
  // o cron medir e calar justamente sobre o número que o usuário lê na gôndola.
  for (const r of resumo.zonaMorta) {
    considerar(`zona morta — ${r.familia} (base)`, r.base);
    considerar(`zona morta — ${r.familia} (deriva mensal)`, r.derivaMensal);
  }
  return divergencias;
}

/** Forma numérica comum a toda medição calibrável — só o que o aviso precisa ler. */
type RecomendacaoComparavel = {
  valorAtual: number;
  valorRecomendado?: number;
  amostrasAvaliadas: number;
  detalhe: string;
};

/** Mensagem do webhook. `undefined` quando não há decisão pendente. */
export function formatarAvisoCalibracao(
  divergencias: readonly DivergenciaCalibracao[],
): string | undefined {
  if (divergencias.length === 0) return undefined;
  const linhas = divergencias.map(
    (d) =>
      `• ${d.parametro}: atual ${d.valorAtual} → medido ${d.valorRecomendado} ` +
      `(${d.amostrasAvaliadas} grupos · ${d.detalhe})`,
  );
  return [
    '🟡 Barganha — a calibração do motor já pode ser medida',
    'O pool ficou fundo o bastante e a medição discorda do valor vigente:',
    ...linhas,
    'Nada foi aplicado. Conferir com `npm run job:calibracao`, decidir e, se trocar, ' +
      'rodar o `job:recalculo` completo — o peso novo muda toda mediana já gravada.',
  ].join('\n');
}

// ────────────────────────────────── Execução ──────────────────────────────

/**
 * Núcleo testável: recebe o pool já carregado e roda as quatro medições.
 *
 * `categoriaPorProduto` é opcional — sem ele a zona morta ainda é medida, toda
 * na família `outros`. É o retrato correto de um catálogo sem enriquecimento,
 * não um resultado degradado.
 */
export function calibrar(
  observacoes: readonly ObservacaoParaAgregacao[],
  referencia: Date,
  categoriaPorProduto?: ReadonlyMap<string, string>,
): ResumoCalibracao {
  const grupos = agruparParaCalibracao(observacoes);
  return {
    meiaVida: calibrarMeiaVida(grupos, { referencia }),
    fatorCerco: calibrarFatorCerco(grupos, { referencia }),
    minimoPorNivel: calibrarMinimoObservacoes(grupos, { referencia }),
    zonaMorta: calibrarZonaMorta(grupos, {
      referencia,
      ...(categoriaPorProduto ? { categoriaPorProduto } : {}),
    }),
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
  const categorias = await carregarCategorias(repo, observacoes);
  const resumo = calibrar(observacoes, referencia, categorias);

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
      produtosComCategoria: categorias.size,
      zonaMorta: resumo.zonaMorta.map((r) => ({
        familia: r.familia,
        base: {
          valorAtual: r.base.valorAtual,
          valorRecomendado: r.base.valorRecomendado,
          amostrasAvaliadas: r.base.amostrasAvaliadas,
        },
        derivaMensal: {
          valorAtual: r.derivaMensal.valorAtual,
          valorRecomendado: r.derivaMensal.valorRecomendado,
          amostrasAvaliadas: r.derivaMensal.amostrasAvaliadas,
        },
      })),
    },
    'Medição de calibração da agregação concluída',
  );

  // Rodado manualmente por humano decidindo se/como recalibrar — vale um
  // console.log legível além do log estruturado (mesmo padrão de cobertura-tipico).
  imprimirRelatorio(resumo);

  await avisarSeDivergir(resumo, log);

  return resumo;
}

/**
 * Manda ao webhook o que exige decisão humana. Falhar em AVISAR nunca derruba a
 * medição: o relatório e o log acima já registraram o resultado — mesmo
 * tratamento do `job:alerta-parsing`.
 */
async function avisarSeDivergir(
  resumo: ResumoCalibracao,
  log: ReturnType<typeof logDeJob>,
): Promise<void> {
  const divergencias = divergenciasDeCalibracao(resumo);
  const mensagem = formatarAvisoCalibracao(divergencias);
  if (mensagem === undefined) return;

  // `warn`, não `error`: nada quebrou — há uma decisão devida.
  log.warn(
    { action: 'calibracao_estatistica.divergencia', divergencias },
    'A medição recomenda valores diferentes dos vigentes',
  );

  const webhookUrl = process.env.ALERTA_WEBHOOK_URL;
  try {
    const enviado = await enviarAlerta(mensagem, { ...(webhookUrl ? { webhookUrl } : {}) });
    if (!enviado && webhookUrl) {
      log.warn(
        { action: 'calibracao_estatistica.webhook_recusado' },
        'Webhook não aceitou o aviso',
      );
    }
  } catch (erro) {
    log.warn(
      { action: 'calibracao_estatistica.webhook_falhou', erro: sanitizarErro(erro) },
      'Falha ao enviar o aviso ao webhook',
    );
  }
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
