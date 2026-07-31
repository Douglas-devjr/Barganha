/**
 * Ponto de entrada do backend. Lê a config, monta os adaptadores reais
 * (Supabase + SEFAZ HTTP) e sobe o servidor HTTP: ingestão (C2), consulta de
 * preço e delta sync (C4) + autenticação por JWT do Supabase (C4.3.1)
 * compartilham o processo. Login obrigatório nos endpoints privados.
 */

import { montarBackend } from './composicao';
import { lerConfig } from './config/env';
import { construirServidor } from './http/servidor';
import { log } from './observabilidade/log';
import { sanitizarErro, sanitizarErroInesperado } from './observabilidade/sanitizar';

export async function main(): Promise<void> {
  const config = lerConfig();
  const {
    servicoIngestao,
    servicoConsulta,
    servicoBuscaProdutos,
    servicoComparacaoLista,
    servicoSync,
    servicoSyncCatalogo,
    autenticacao,
    gerenciadorConta,
    telemetria,
    servicoModeracao,
    servicoDenuncia,
    servicoCuradoria,
    guardaCuradoria,
    reprocessador,
    matcherTexto,
    saude,
    metricasPerformance,
    fila,
  } = montarBackend(config);
  const app = construirServidor({
    servicoIngestao,
    servicoConsulta,
    servicoBuscaProdutos,
    servicoComparacaoLista,
    servicoSync,
    servicoSyncCatalogo,
    autenticacao,
    gerenciadorConta,
    metricas: telemetria,
    saude,
    metricasPerformance,
    // C11 — expansão: lançamento manual + moderação + enriquecimento + reprocesso
    // + sugestões de casamento por texto (C3.5) para a curadoria.
    servicoModeracao,
    servicoDenuncia,
    servicoCuradoria,
    autorizacaoCuradoria: guardaCuradoria,
    reprocessador,
    matcherTexto,
    trustProxy: config.trustProxy,
    logger: true,
  });
  await app.listen({ port: config.porta, host: '0.0.0.0' });

  // C2.1 — liga o consumidor da fila. Na fila durável isto sobe o poll, que é
  // como esta instância vê o trabalho que não passou pelo seu próprio
  // `enfileirar`: enfileirado por OUTRA instância, saindo do backoff, ou órfão
  // de uma instância que morreu no meio. Depois do `listen`: drenar cupom não
  // pode atrasar a subida do servidor.
  fila.iniciar?.();

  log.info(
    {
      action: 'boot.pronto',
      porta: config.porta,
      ambiente: config.nodeEnv,
      filaDuravel: config.filaDuravel,
      // Carimba a versão no boot: é a linha que amarra "o que subiu" ao resto do
      // log daquela instância, sem depender de ninguém chamar `/saude`.
      versao: config.versao,
      ufsHabilitadas: config.ufsHabilitadas,
    },
    'Backend no ar',
  );

  // Recuperação de boot. Com a fila DURÁVEL isto deixou de ser o remendo do
  // restart (a tarefa sobrevive na tabela, e a lease vencida devolve à fila o que
  // uma instância morta estava processando). Continua valendo para o cupom que
  // NUNCA chegou à fila: o `enfileirar` falhou, ou a linha se perdeu — nesse caso
  // o cupom está em `qr_capturado` e ninguém tem tarefa dele. É idempotente (o
  // enfileiramento não rearma tarefa com lease viva), então rodar sempre é
  // barato. Depois do `listen` e sem `await`: o servidor já atende enquanto drena.
  void reprocessador
    .recuperarPendentes({ limite: LIMITE_RECUPERACAO_BOOT })
    .then((n) => {
      if (n > 0) {
        log.info(
          { action: 'boot.recuperacao', cupons: n },
          'Cupons pendentes re-enfileirados após o restart',
        );
      }
    })
    .catch((erro) => {
      // Não impede o servidor de atender; o gatilho manual de reprocessamento
      // (C11.1) e a próxima subida tentam de novo. `warn`, não `error`: o
      // servidor está de pé e há dois caminhos de recuperação.
      log.warn(
        { action: 'boot.recuperacao_falhou', erro: sanitizarErro(erro) },
        'Falha ao recuperar cupons pendentes — servidor segue atendendo',
      );
    });

  // Encerramento ordenado. O Render manda SIGTERM em todo deploy: sem isto o
  // processo morre no meio de um poll e as tarefas reivindicadas só voltam à
  // fila quando a lease vence (minutos). Parando de reivindicar primeiro, a
  // instância nova pega o trabalho na hora.
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      log.info({ action: 'encerrar.inicio', sinal }, 'Encerrando o backend');
      fila.parar?.();
      void app.close().then(
        () => {
          log.info({ action: 'encerrar.pronto', sinal }, 'Backend encerrado');
        },
        (erro: unknown) => {
          log.warn(
            { action: 'encerrar.falhou', sinal, erro: sanitizarErro(erro) },
            'Falha ao fechar o servidor HTTP',
          );
        },
      );
    });
  }
}

/** Teto de cupons re-enfileirados por UF no boot — não afogar o portal da SEFAZ. */
const LIMITE_RECUPERACAO_BOOT = 200;

main().catch((erro) => {
  // `fatal`: o único nível acima de `error`. O processo não sobe — config
  // ausente ou porta ocupada. Nada aqui é recuperável em execução.
  //
  // Com pilha (C10.4): é o log que alguém lê às 3h com o serviço fora do ar, e
  // "Cannot read properties of undefined" sem frame nenhum não diz onde olhar.
  log.fatal(
    { action: 'boot.falhou', erro: sanitizarErroInesperado(erro) },
    'Falha ao iniciar o backend',
  );
  process.exitCode = 1;
});
