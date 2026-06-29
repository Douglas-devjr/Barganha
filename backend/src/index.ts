/**
 * Ponto de entrada do backend. Lê a config, monta os adaptadores reais
 * (Supabase + SEFAZ HTTP) e sobe o servidor HTTP: ingestão (C2), consulta de
 * preço e delta sync (C4) + conta/auth mínima (C4.3) compartilham o processo.
 */

import { montarBackend } from './composicao';
import { lerConfig } from './config/env';
import { construirServidor } from './http/servidor';

export async function main(): Promise<void> {
  const config = lerConfig();
  const {
    servicoIngestao,
    servicoConsulta,
    servicoSync,
    servicoConta,
    autenticacao,
    telemetria,
    servicoModeracao,
    servicoCuradoria,
    guardaCuradoria,
    reprocessador,
  } = montarBackend(config);
  const app = construirServidor({
    servicoIngestao,
    servicoConsulta,
    servicoSync,
    servicoConta,
    autenticacao,
    metricas: telemetria,
    // C11 — expansão: lançamento manual + moderação + enriquecimento + reprocesso.
    servicoModeracao,
    servicoCuradoria,
    autorizacaoCuradoria: guardaCuradoria,
    reprocessador,
    trustProxy: config.trustProxy,
    logger: true,
  });
  await app.listen({ port: config.porta, host: '0.0.0.0' });
}

main().catch((erro) => {
  console.error('Falha ao iniciar o backend:', erro);
  process.exitCode = 1;
});
