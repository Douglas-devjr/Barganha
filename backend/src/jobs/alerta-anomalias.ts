/**
 * C10.4 — Job de alerta de anomalias.
 *
 * DIFERENÇA IMPORTANTE PARA O `alerta-parsing`: aquele lê a telemetria
 * PERSISTIDA no Postgres, então roda contra o banco e não precisa da API de pé.
 * As métricas de performance, por outro lado, vivem na MEMÓRIA do processo que
 * atende (é o "agora" daquela instância) — não existe tabela para consultar.
 * Por isso este job fala HTTP com a API em produção.
 *
 * Consequência que vale entender antes de interpretar um alerta: no free tier a
 * instância dorme e a memória zera. Os números refletem a janela desde que ela
 * acordou, não o dia inteiro. Para latência e cache é exatamente o que se quer;
 * para volume, o histórico durável continua sendo o de parsing.
 *
 * `/saude` é público; `/metricas` exige token de curadoria. Sem o token o job
 * ainda avalia as regras de saúde — meio alerta é melhor que nenhum.
 *
 * Execução (workspace @barganha/backend):
 *   API_URL=https://... CURADORIA_TOKEN=... npm run job:alerta-anomalias
 */

import { fileURLToPath } from 'node:url';

import { logDeJob } from '../observabilidade/log';
import { enviarAlerta } from '../observabilidade/alerta-parsing';
import type { SnapshotMetricas } from '../observabilidade/metricas';
import {
  type Anomalia,
  avaliarAnomalias,
  formatarAnomalias,
  lerLimiares,
} from '../observabilidade/regras-alerta';
import type { RelatorioSaude } from '../observabilidade/saude';
import { sanitizarErro, sanitizarErroInesperado } from '../observabilidade/sanitizar';

/** Teto por chamada. A instância pode estar acordando (30–60s no free tier). */
const TIMEOUT_MS = 90_000;

export interface OpcoesAlertaAnomalias {
  apiUrl: string;
  /** Token de curadoria — sem ele, `/metricas` não é consultado. */
  curadoriaToken?: string;
  fetchFn?: typeof fetch;
}

async function buscarJson<T>(
  url: string,
  fetchFn: typeof fetch,
  token?: string,
): Promise<T | undefined> {
  const resposta = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 503 do `/saude/pronto` é resposta LEGÍTIMA com corpo — é justamente o caso
  // que interessa alertar. Só corpo ausente/ilegível vira `undefined`.
  if (!resposta.ok && resposta.status !== 503) return undefined;
  return (await resposta.json()) as T;
}

/** Núcleo testável: colhe os snapshots e devolve as anomalias encontradas. */
export async function avaliarApi(opcoes: OpcoesAlertaAnomalias): Promise<Anomalia[]> {
  const fetchFn = opcoes.fetchFn ?? globalThis.fetch;
  const base = opcoes.apiUrl.replace(/\/+$/, '');

  const saude = await buscarJson<RelatorioSaude>(`${base}/saude`, fetchFn);
  if (!saude) {
    // A API não respondeu nada utilizável. É o pior estado possível e não tem
    // como ser detectado pelas regras (que precisam de um relatório) — então
    // vira anomalia crítica aqui mesmo.
    return [
      {
        regra: 'api-fora',
        severidade: 'critico',
        mensagem: `${base}/saude não respondeu um relatório utilizável`,
      },
    ];
  }

  let metricas: SnapshotMetricas | undefined;
  if (opcoes.curadoriaToken) {
    const corpo = await buscarJson<{ performance?: SnapshotMetricas }>(
      `${base}/metricas`,
      fetchFn,
      opcoes.curadoriaToken,
    );
    metricas = corpo?.performance;
  }

  return avaliarAnomalias(saude, metricas, lerLimiares());
}

export async function main(): Promise<void> {
  const log = logDeJob('alerta-anomalias');
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    log.error({ action: 'alerta.sem_api_url' }, 'API_URL ausente — nada a verificar');
    process.exitCode = 1;
    return;
  }

  const curadoriaToken = process.env.CURADORIA_TOKEN;
  if (!curadoriaToken) {
    log.warn(
      { action: 'alerta.sem_token' },
      'CURADORIA_TOKEN ausente — só as regras de saúde serão avaliadas',
    );
  }

  const anomalias = await avaliarApi({
    apiUrl,
    ...(curadoriaToken ? { curadoriaToken } : {}),
  });

  if (anomalias.length === 0) {
    log.info({ action: 'alerta.anomalias_ok' }, 'Nenhuma anomalia acima dos limiares');
    return;
  }

  const critico = anomalias.some((a) => a.severidade === 'critico');
  // `error` só no crítico. Degradação é `warn` — se toda oscilação virasse
  // `error`, o alerta seria desligado na primeira semana (política de
  // níveis em `observabilidade/log.ts`).
  const registrar = critico ? log.error.bind(log) : log.warn.bind(log);
  registrar(
    { action: 'alerta.anomalias', anomalias },
    critico ? 'Anomalia crítica detectada' : 'Degradação detectada',
  );

  const webhookUrl = process.env.ALERTA_WEBHOOK_URL;
  try {
    const enviado = await enviarAlerta(formatarAnomalias(anomalias), {
      ...(webhookUrl ? { webhookUrl } : {}),
    });
    if (!enviado && webhookUrl) {
      log.warn({ action: 'alerta.webhook_recusado' }, 'Webhook não aceitou o alerta');
    }
  } catch (erro) {
    // Falhar em AVISAR não derruba o job: a linha acima já registrou o problema.
    log.warn(
      { action: 'alerta.webhook_falhou', erro: sanitizarErro(erro) },
      'Falha ao enviar o alerta ao webhook',
    );
  }

  // Código de saída diferente de zero só no crítico: assim o workflow fica
  // vermelho quando alguém precisa agir, e verde-com-aviso na degradação.
  if (critico) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((erro) => {
    // Catch-all do job — com pilha (C10.4), ver nota em `recalculo-estatistica`.
    logDeJob('alerta-anomalias').fatal(
      { erro: sanitizarErroInesperado(erro) },
      'Job de alerta de anomalias falhou',
    );
    process.exitCode = 1;
  });
}
