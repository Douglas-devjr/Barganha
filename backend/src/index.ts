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
  } = montarBackend(config);
  const app = construirServidor({
    servicoIngestao,
    servicoConsulta,
    servicoBuscaProdutos,
    servicoComparacaoLista,
    servicoSync,
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
  log.info(
    {
      action: 'boot.pronto',
      porta: config.porta,
      ambiente: config.nodeEnv,
      // Carimba a versão no boot: é a linha que amarra "o que subiu" ao resto do
      // log daquela instância, sem depender de ninguém chamar `/saude`.
      versao: config.versao,
      ufsHabilitadas: config.ufsHabilitadas,
    },
    'Backend no ar',
  );

  // Recuperação de boot: a fila é in-process, então um restart (deploy, ou a
  // instância acordando no free tier) deixaria cupons presos em `qr_capturado`
  // sem ninguém para processá-los. Depois do `listen` e sem `await` no caminho
  // de subida — o servidor já atende enquanto isto drena.
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
