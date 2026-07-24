/**
 * Job de vigilância do parsing (C10.2). Lê a telemetria persistida, avalia a
 * saúde por UF e avisa quando alguma degrada.
 *
 * Rodado por scheduler externo (GitHub Actions cron em
 * `.github/workflows/alerta-parsing.yml`):
 *   npm run job:alerta-parsing   (workspace @barganha/backend)
 *
 * Sem `ALERTA_WEBHOOK_URL` configurado o job só LOGA — continua útil (a linha
 * `error` fica no histórico do Actions) e não quebra ambiente sem webhook.
 *
 * Saída: código 0 mesmo com UF degradada. O job não é um teste; falhar o
 * workflow por causa de um portal fora do ar geraria ruído de "build vermelho"
 * que se aprende a ignorar — exatamente o que o alerta quer evitar.
 */

import { fileURLToPath } from 'node:url';

import { montarBackend } from '../composicao';
import { lerConfig } from '../config/env';
import {
  avaliarSaudeParsing,
  enviarAlerta,
  formatarAlerta,
} from '../observabilidade/alerta-parsing';
import { logDeJob } from '../observabilidade/log';
import { sanitizarErro } from '../observabilidade/sanitizar';

export async function main(): Promise<void> {
  const log = logDeJob('alerta-parsing');
  const config = lerConfig();
  const { telemetria } = montarBackend(config);

  const resultado = avaliarSaudeParsing(telemetria.snapshot());

  if (resultado.degradadas.length === 0 && resultado.falhasPersistencia === 0) {
    log.info({ action: 'alerta.parsing_ok' }, 'Parsing saudável em todas as UFs');
    return;
  }

  const mensagem = formatarAlerta(resultado);
  // `error` porque exige ação humana: um parser quebrado não se conserta sozinho.
  log.error(
    {
      action: 'alerta.parsing_degradado',
      ufs: resultado.degradadas.map((d) => ({ uf: d.uf, taxa: d.taxa, motivo: d.principalMotivo })),
      falhasPersistencia: resultado.falhasPersistencia,
    },
    'Parsing degradado',
  );

  const webhookUrl = process.env.ALERTA_WEBHOOK_URL;
  try {
    const enviado = await enviarAlerta(mensagem, { ...(webhookUrl ? { webhookUrl } : {}) });
    if (!enviado && webhookUrl) {
      log.warn({ action: 'alerta.webhook_recusado' }, 'Webhook não aceitou o alerta');
    }
  } catch (erro) {
    // Falhar em AVISAR não pode derrubar o job — a linha de log acima já
    // registrou o problema real.
    log.warn(
      { action: 'alerta.webhook_falhou', erro: sanitizarErro(erro) },
      'Falha ao enviar o alerta ao webhook',
    );
  }
}

// Executado direto (não quando importado por um teste).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((erro) => {
    logDeJob('alerta-parsing').fatal({ erro: sanitizarErro(erro) }, 'Job de alerta falhou');
    process.exitCode = 1;
  });
}
