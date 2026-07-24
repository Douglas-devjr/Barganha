/**
 * Alerta de saúde do parsing por UF (C10.2).
 *
 * O problema que resolve: a telemetria por estado já existia e ninguém a olhava.
 * Quando um portal da SEFAZ muda de layout — o que acontece sem aviso, por conta
 * de cada estado — o parser daquela UF passa a falhar em 100% dos cupons. O
 * backend loga `error` no stdout, os usuários escaneiam notas que nunca ficam
 * prontas, e a primeira notícia disso é alguém reclamando.
 *
 * Aqui a decisão é PURA (`avaliarSaudeParsing`), sobre o snapshot que
 * `/metricas` já produz. O envio é um webhook — Discord/Slack/qualquer coisa que
 * aceite um POST com JSON. Sem SDK, sem dependência nova, sem conta paga.
 *
 * Deliberadamente NÃO alerta por volume baixo: uma UF com 2 cupons e 1 falha tem
 * 50% de taxa e não significa nada. Só passa do mínimo de amostra é que a taxa
 * vira sinal.
 */

import type { EventoParsing, SnapshotTelemetria } from './telemetria';

/** Eventos que representam um cupom NÃO entregue por culpa nossa/do portal. */
const EVENTOS_FALHA: EventoParsing[] = [
  'falha_permanente',
  'transitorio_esgotado',
  'erro_portal',
];

/** Eventos que contam como tentativa concluída (base da taxa). */
const EVENTOS_TOTAL: EventoParsing[] = ['processado', ...EVENTOS_FALHA];

export interface LimiaresAlerta {
  /** Taxa de falha (0–1) a partir da qual a UF é considerada degradada. */
  taxaFalha: number;
  /** Mínimo de tentativas na UF para a taxa ter significado estatístico. */
  amostraMinima: number;
}

export const LIMIARES_PADRAO: LimiaresAlerta = {
  // 30%: alto o bastante para não disparar com a oscilação normal do reCAPTCHA
  // do RJ, baixo o bastante para pegar um parser quebrado (que vai a ~100%).
  taxaFalha: 0.3,
  amostraMinima: 20,
};

export interface UfDegradada {
  uf: string;
  tentativas: number;
  falhas: number;
  /** Taxa de falha (0–1). */
  taxa: number;
  /** Evento de falha mais frequente — a pista do que investigar primeiro. */
  principalMotivo: EventoParsing;
}

export interface ResultadoAvaliacao {
  degradadas: UfDegradada[];
  /** Falhas ao PERSISTIR telemetria: o instrumento avisando que ele quebrou. */
  falhasPersistencia: number;
}

/** Decisão pura: quais UFs estão degradadas neste snapshot. */
export function avaliarSaudeParsing(
  snapshot: SnapshotTelemetria,
  limiares: LimiaresAlerta = LIMIARES_PADRAO,
): ResultadoAvaliacao {
  const degradadas: UfDegradada[] = [];

  for (const [uf, contadores] of Object.entries(snapshot.porUf)) {
    const soma = (eventos: EventoParsing[]) =>
      eventos.reduce((total, e) => total + (contadores[e] ?? 0), 0);

    const tentativas = soma(EVENTOS_TOTAL);
    if (tentativas < limiares.amostraMinima) continue;

    const falhas = soma(EVENTOS_FALHA);
    const taxa = falhas / tentativas;
    if (taxa < limiares.taxaFalha) continue;

    // Maior contribuinte entre os eventos de falha — `erro_portal` aponta para
    // reCAPTCHA, `falha_permanente` para layout mudado. Reações diferentes.
    const principalMotivo = EVENTOS_FALHA.reduce((pior, e) =>
      (contadores[e] ?? 0) > (contadores[pior] ?? 0) ? e : pior,
    );

    degradadas.push({ uf, tentativas, falhas, taxa, principalMotivo });
  }

  // Pior primeiro: quem lê o alerta age na primeira linha.
  degradadas.sort((a, b) => b.taxa - a.taxa);

  return { degradadas, falhasPersistencia: snapshot.saude?.falhasPersistencia ?? 0 };
}

/** Mensagem humana do alerta. Sem PII: só UF e contadores agregados. */
export function formatarAlerta(resultado: ResultadoAvaliacao): string {
  const linhas = resultado.degradadas.map(
    (d) =>
      `• ${d.uf}: ${(d.taxa * 100).toFixed(0)}% de falha ` +
      `(${d.falhas}/${d.tentativas}) — principal: ${d.principalMotivo}`,
  );
  if (resultado.falhasPersistencia > 0) {
    linhas.push(
      `• telemetria: ${resultado.falhasPersistencia} gravação(ões) falharam — ` +
        'os números podem estar incompletos.',
    );
  }
  return ['🔴 Barganha — parsing degradado', ...linhas].join('\n');
}

export interface EnvioAlerta {
  /** URL do webhook (Discord/Slack/genérico). Ausente → não envia, só loga. */
  webhookUrl?: string;
  fetchFn?: typeof fetch;
}

/**
 * Envia o alerta ao webhook. `content` é o campo do Discord; `text`, o do Slack —
 * mandamos os dois para o mesmo corpo servir aos dois destinos sem configuração.
 * Devolve `false` quando não havia webhook ou o POST falhou (o chamador loga).
 */
export async function enviarAlerta(mensagem: string, envio: EnvioAlerta): Promise<boolean> {
  if (!envio.webhookUrl) return false;
  const fetchFn = envio.fetchFn ?? globalThis.fetch;
  const resposta = await fetchFn(envio.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: mensagem, text: mensagem }),
  });
  return resposta.ok;
}
