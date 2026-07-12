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
    servicoCuradoria,
    autorizacaoCuradoria: guardaCuradoria,
    reprocessador,
    matcherTexto,
    trustProxy: config.trustProxy,
    logger: true,
  });
  await app.listen({ port: config.porta, host: '0.0.0.0' });
}

main().catch((erro) => {
  console.error('Falha ao iniciar o backend:', erro);
  process.exitCode = 1;
});
