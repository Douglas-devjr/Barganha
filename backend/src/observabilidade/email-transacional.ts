/**
 * Canal de e-mail transacional (docs/04 — aviso de retenção por inatividade,
 * C9.2). Hoje o único consumidor é `job:purga-inativos` ("sem aviso, sem
 * purga"): sem este canal configurado, `enviarEmail` devolve `false` e a
 * purga fica travada por segurança.
 *
 * Provedor: Resend, via API HTTP direta com `fetch` — MESMO padrão de
 * `enviarAlerta` (`./alerta-parsing.ts`): sem SDK, sem dependência nova, sem
 * conta paga (o free tier da Resend não pede cartão). `fetchFn` é injetável
 * para o teste não bater na rede de verdade.
 *
 * Fail-closed: `apiKey`/`remetente` ausentes → não tenta nada, devolve
 * `false`. É a mesma trava do webhook (URL ausente = não envia).
 *
 * LGPD (docs/04): o destinatário é PII. O log NUNCA grava o corpo do e-mail
 * nem o endereço, nem sequer mascarado — `redigirTexto` deixa um prefixo do
 * endereço em claro, o que é PII demais para uma linha de log de rotina.
 * Em vez disso o CHAMADOR passa uma `referencia` opaca (ex.: o id da conta),
 * que já não tem relação de leitura direta com o e-mail, e é isso que vai
 * ao log — nunca o `destinatario` em si.
 */

import { logDeJob } from './log';
import { redigirTexto } from './sanitizar';

export interface ParametrosEmail {
  destinatario: string;
  assunto: string;
  corpoTexto: string;
  /**
   * Referência opaca para correlacionar este envio no log SEM logar o
   * e-mail — o chamador escolhe (ex.: o id da conta), nunca deriva do
   * próprio `destinatario`.
   */
  referencia: string;
}

export interface EnvioEmail {
  /** Chave de API da Resend. Ausente → não envia (fail-closed). */
  apiKey?: string;
  /** Remetente (`from`) verificado na Resend. Ausente → não envia. */
  remetente?: string;
  fetchFn?: typeof fetch;
}

const RESEND_URL = 'https://api.resend.com/emails';

/**
 * Envia um e-mail transacional via Resend. Devolve `true` só se a API aceitou
 * o envio (`resposta.ok`). Nunca lança: falha de rede/API vira `false`, quem
 * chama decide o que fazer (no caso da purga: não avançar o relógio).
 */
export async function enviarEmail(params: ParametrosEmail, envio: EnvioEmail): Promise<boolean> {
  const log = logDeJob('email-transacional');

  if (!envio.apiKey || !envio.remetente) {
    // Sem provedor configurado: fail-closed, sem tentativa nenhuma.
    return false;
  }

  const fetchFn = envio.fetchFn ?? globalThis.fetch;
  try {
    const resposta = await fetchFn(RESEND_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${envio.apiKey}`,
      },
      body: JSON.stringify({
        from: envio.remetente,
        to: [params.destinatario],
        subject: params.assunto,
        text: params.corpoTexto,
      }),
    });

    if (!resposta.ok) {
      log.warn(
        { action: 'email.recusado', referencia: params.referencia, status: resposta.status },
        'Resend recusou o envio do e-mail',
      );
      return false;
    }

    log.info(
      { action: 'email.enviado', referencia: params.referencia },
      'E-mail transacional enviado',
    );
    return true;
  } catch (erro) {
    log.warn(
      { action: 'email.falhou', referencia: params.referencia, erro: redigirTexto(String(erro)) },
      'Falha ao enviar e-mail transacional',
    );
    return false;
  }
}
