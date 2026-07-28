/**
 * C11.5 automático — Job em lote de enriquecimento de produto via catálogo
 * VTEX. Roda por scheduler externo (GitHub Actions cron diário, ou manual):
 *   npm run job:enriquecer   (workspace @barganha/backend)
 *
 * Redes vêm de `REDES_VTEX` (JSON; ver fontes/redes.ts). Sem redes → no-op.
 * Lote pequeno + pausa entre requisições: cada EAN é consultado UMA vez na
 * vida (produto enriquecido sai da elegibilidade) — volume educado por design.
 */

import { fileURLToPath } from 'node:url';

import { lerConfig } from '../config/env';
import { RepositorioSupabase } from '../persistencia/repositorio-supabase';
import { criarClienteSupabase } from '../persistencia/supabase';

import { parseRedesVtex } from '../fontes/redes';
import { logDeJob } from '../observabilidade/log';
import { sanitizarErroInesperado } from '../observabilidade/sanitizar';
import { ServicoEnriquecimentoCatalogo } from '../fontes/servico-enriquecimento-catalogo';
import { ClienteVtex } from '../fontes/vtex/cliente-vtex';

export async function rodarJobEnriquecimento(): Promise<void> {
  const registro = logDeJob('enriquecer-catalogo');
  const config = lerConfig();
  const redes = parseRedesVtex(process.env.REDES_VTEX);
  if (redes.length === 0) {
    registro.info({ motivo: 'REDES_VTEX vazio' }, 'Nada a fazer');
    return;
  }

  const repo = new RepositorioSupabase(
    criarClienteSupabase(config.supabaseUrl, config.supabaseServiceRoleKey),
  );
  const servico = new ServicoEnriquecimentoCatalogo(repo, new ClienteVtex(), redes);

  const inicio = Date.now();
  const r = await servico.executar();
  registro.info(
    {
      redes: redes.map((x) => x.id),
      examinados: r.examinados,
      enriquecidos: r.enriquecidos,
      semCatalogo: r.semCatalogo,
      falhas: r.falhas,
      duracaoMs: Date.now() - inicio,
    },
    'Enriquecimento de catálogo concluído',
  );
}

// Executado direto (não quando importado por um teste): roda e propaga o código
// de saída para o scheduler detectar falha.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rodarJobEnriquecimento().catch((erro) => {
    // `error` e não `fatal`: o catálogo enriquecido é melhoria de exibição — o
    // veredito (que é o produto) continua funcionando sem ele.
    // Catch-all do job — com pilha (C10.4), ver nota em `recalculo-estatistica`.
    logDeJob('enriquecer-catalogo').error({ erro: sanitizarErroInesperado(erro) }, 'Job falhou');
    process.exitCode = 1;
  });
}
