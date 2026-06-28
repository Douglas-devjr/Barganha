/**
 * Raiz de composição do backend (C2): liga os adaptadores reais (Supabase +
 * SEFAZ HTTP) ao domínio. Trocar uma peça (ex.: fila durável na infra C10)
 * é mexer só aqui — o domínio não conhece implementação concreta.
 */

import { Anonimizador } from './anonimizacao/anonimizador';
import type { ConfigBackend } from './config/env';
import { MatcherTexto } from './estatistica/casamento-texto';
import { PipelineEstatistica } from './estatistica/pipeline';
import { FilaMemoria } from './fila/fila-memoria';
import { ServicoIngestao } from './ingestao/servico-ingestao';
import { RegistroParsers } from './parsers/registro';
import { ParserRj } from './parsers/rj';
import { ParserSp } from './parsers/sp';
import { RepositorioSupabase } from './persistencia/repositorio-supabase';
import { criarClienteSupabase } from './persistencia/supabase';
import { ProcessadorCupom } from './processamento/processador-cupom';
import { ReprocessadorRetroativo } from './processamento/reprocessamento';
import { ClienteSefazHttp } from './sefaz/cliente-sefaz-http';

export interface Backend {
  servicoIngestao: ServicoIngestao;
  reprocessador: ReprocessadorRetroativo;
  registro: RegistroParsers;
  /** Motor estatístico (C3): recalcula `preco_estatistica` a partir do pool. */
  pipelineEstatistica: PipelineEstatistica;
  /** Casamento por texto (C3.5) p/ itens sem EAN. */
  matcherTexto: MatcherTexto;
}

export function montarBackend(config: ConfigBackend): Backend {
  const db = criarClienteSupabase(config.supabaseUrl, config.supabaseServiceRoleKey);
  const repo = new RepositorioSupabase(db);

  const cliente = new ClienteSefazHttp();
  const registro = new RegistroParsers([new ParserRj(cliente), new ParserSp(cliente)]);

  const anonimizador = new Anonimizador(repo);
  const processador = new ProcessadorCupom(repo, registro, anonimizador);
  const fila = new FilaMemoria((t) => processador.processar(t.cupomId), {
    aoEsgotar: (tarefa, erro) => {
      // Telemetria por estado entra em C10.2; por ora, registra no console.
      console.error(`Falha persistente ao processar cupom ${tarefa.cupomId}:`, erro);
    },
  });

  const servicoIngestao = new ServicoIngestao(repo, fila);
  const reprocessador = new ReprocessadorRetroativo(repo, registro, fila);

  // C3 — motor estatístico sobre o pool anônimo. O disparo (após ingestão ou
  // num job agendado) é decidido na API/infra (C4/C10); aqui ele só é montado.
  const pipelineEstatistica = new PipelineEstatistica(repo, repo);
  const matcherTexto = new MatcherTexto(repo);

  return { servicoIngestao, reprocessador, registro, pipelineEstatistica, matcherTexto };
}
