/**
 * Ponto de entrada do backend (C2). Lê a config, monta os adaptadores reais
 * (Supabase + SEFAZ HTTP) e sobe o servidor HTTP de ingestão.
 *
 * Os parsers SEFAZ, a anonimização e a API de consulta (C4) compartilham este
 * mesmo processo; a API de consulta/sync chega na Camada 4.
 */

import { montarBackend } from './composicao';
import { lerConfig } from './config/env';
import { construirServidor } from './http/servidor';

export async function main(): Promise<void> {
  const config = lerConfig();
  const { servicoIngestao } = montarBackend(config);
  const app = construirServidor({ servicoIngestao, logger: true });
  await app.listen({ port: config.porta, host: '0.0.0.0' });
}

main().catch((erro) => {
  console.error('Falha ao iniciar o backend:', erro);
  process.exitCode = 1;
});
