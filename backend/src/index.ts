/**
 * Ponto de entrada do backend. Lê a config, monta os adaptadores reais
 * (Supabase + SEFAZ HTTP) e sobe o servidor HTTP: ingestão (C2), consulta de
 * preço e delta sync (C4) + autenticação por JWT do Supabase (C4.3.1)
 * compartilham o processo. Login obrigatório nos endpoints privados.
 */

import { montarBackend } from './composicao';
import { lerConfig } from './config/env';
import { construirServidor } from './http/servidor';

export async function main(): Promise<void> {
  const config = lerConfig();
  const {
    servicoIngestao,
    servicoConsulta,
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
  } = montarBackend(config);
  const app = construirServidor({
    servicoIngestao,
    servicoConsulta,
    servicoComparacaoLista,
    servicoSync,
    autenticacao,
    gerenciadorConta,
    metricas: telemetria,
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

  // Recuperação de boot: a fila é in-process, então um restart (deploy, ou a
  // instância acordando no free tier) deixaria cupons presos em `qr_capturado`
  // sem ninguém para processá-los. Depois do `listen` e sem `await` no caminho
  // de subida — o servidor já atende enquanto isto drena.
  void reprocessador
    .recuperarPendentes({ limite: LIMITE_RECUPERACAO_BOOT })
    .then((n) => {
      if (n > 0) console.log(`[boot] ${n} cupom(ns) pendente(s) re-enfileirado(s).`);
    })
    .catch((erro) => {
      // Não impede o servidor de atender; o gatilho manual de reprocessamento
      // (C11.1) e a próxima subida tentam de novo.
      console.error('[boot] falha ao recuperar cupons pendentes:', erro);
    });
}

/** Teto de cupons re-enfileirados por UF no boot — não afogar o portal da SEFAZ. */
const LIMITE_RECUPERACAO_BOOT = 200;

main().catch((erro) => {
  console.error('Falha ao iniciar o backend:', erro);
  process.exitCode = 1;
});
