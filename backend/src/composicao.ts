/**
 * Raiz de composição do backend (C2): liga os adaptadores reais (Supabase +
 * SEFAZ HTTP) ao domínio. Trocar uma peça (ex.: fila durável na infra C10)
 * é mexer só aqui — o domínio não conhece implementação concreta.
 */

import { Anonimizador } from './anonimizacao/anonimizador';
import type { Autenticacao } from './auth/autenticador';
import { AutenticadorSupabase } from './auth/autenticador-supabase';
import { GuardaCuradoria } from './auth/curadoria';
import { GerenciadorContaSupabase } from './auth/gerenciador-conta';
import { VerificadorTokenSupabase } from './auth/verificador-token';
import type { ConfigBackend } from './config/env';
import { ServicoConsulta } from './consulta/servico-consulta';
import { ServicoCuradoria } from './curadoria/servico-curadoria';
import { MatcherTexto } from './estatistica/casamento-texto';
import { PipelineEstatistica } from './estatistica/pipeline';
import { FilaMemoria } from './fila/fila-memoria';
import { ServicoIngestao } from './ingestao/servico-ingestao';
import { ServicoModeracao } from './moderacao/servico-moderacao';
import { TelemetriaMemoria } from './observabilidade/telemetria-memoria';
import { ParserMg } from './parsers/mg';
import { RegistroParsers } from './parsers/registro';
import { ParserRj } from './parsers/rj';
import { ParserSp } from './parsers/sp';
import { RepositorioSupabase } from './persistencia/repositorio-supabase';
import { criarClienteSupabase } from './persistencia/supabase';
import { ProcessadorCupom } from './processamento/processador-cupom';
import { ReprocessadorRetroativo } from './processamento/reprocessamento';
import { ControleRollout } from './rollout/controle-rollout';
import { ClienteSefazHttp } from './sefaz/cliente-sefaz-http';
import { ServicoSync } from './sync/servico-sync';

export interface Backend {
  servicoIngestao: ServicoIngestao;
  reprocessador: ReprocessadorRetroativo;
  registro: RegistroParsers;
  /** Motor estatístico (C3): recalcula `preco_estatistica` a partir do pool. */
  pipelineEstatistica: PipelineEstatistica;
  /** Casamento por texto (C3.5) p/ itens sem EAN. */
  matcherTexto: MatcherTexto;
  /** API de consulta de preço com fallback geo (C4.1). */
  servicoConsulta: ServicoConsulta;
  /** Delta sync incremental do cache de estatística (C4.2). */
  servicoSync: ServicoSync;
  /** Autenticação dos endpoints privados (C4.3.1) — valida o JWT do Supabase. */
  autenticacao: Autenticacao;
  /** Apagamento de conta (C4.3.1) — direito ao apagamento (docs/04). */
  gerenciadorConta: GerenciadorContaSupabase;
  /** Gate de lançamento faseado por UF (C10.3). */
  rollout: ControleRollout;
  /** Telemetria de parsing por estado — fonte do endpoint `/metricas` (C10.2). */
  telemetria: TelemetriaMemoria;
  /** Lançamento manual de gôndola + moderação (C11.3). */
  servicoModeracao: ServicoModeracao;
  /** Enriquecimento de produto pela curadoria (C11.5). */
  servicoCuradoria: ServicoCuradoria;
  /** Autorização dos endpoints de curadoria (C11) — token estático do ambiente. */
  guardaCuradoria: GuardaCuradoria;
}

export function montarBackend(config: ConfigBackend): Backend {
  const db = criarClienteSupabase(config.supabaseUrl, config.supabaseServiceRoleKey);
  const repo = new RepositorioSupabase(db);

  const cliente = new ClienteSefazHttp();
  const registro = new RegistroParsers([
    new ParserRj(cliente),
    new ParserSp(cliente),
    new ParserMg(cliente),
  ]);

  // C10 — lançamento faseado (quais UFs atender agora) + observabilidade do parsing.
  const rollout = new ControleRollout(config.ufsHabilitadas);
  const telemetria = new TelemetriaMemoria();

  const anonimizador = new Anonimizador(repo);
  const processador = new ProcessadorCupom(repo, registro, anonimizador, { rollout, telemetria });
  const fila = new FilaMemoria((t) => processador.processar(t.cupomId), {
    aoEsgotar: (tarefa, erro) => {
      // C10.2 — conta o esgotamento por estado e registra para investigação.
      telemetria.registrarParsing(tarefa.uf, 'transitorio_esgotado');
      console.error(`Falha persistente ao processar cupom ${tarefa.cupomId}:`, erro);
    },
  });

  const servicoIngestao = new ServicoIngestao(repo, fila);
  const reprocessador = new ReprocessadorRetroativo(repo, registro, fila);

  // C3 — motor estatístico sobre o pool anônimo. O disparo (após ingestão ou
  // num job agendado) é decidido na API/infra (C4/C10); aqui ele só é montado.
  const pipelineEstatistica = new PipelineEstatistica(repo, repo);
  const matcherTexto = new MatcherTexto(repo);

  // C4 — API de consulta/sync (lê só o pool compartilhado) + auth real.
  // C4.3.1: login obrigatório (Supabase Auth). O Bearer é um JWT validado
  // contra o GoTrue; o `usuarioId` (= auth.users.id) só identifica o lado
  // PRIVADO — o pool segue anônimo (docs/04). Sem conta anônima em produção.
  const servicoConsulta = new ServicoConsulta(repo, repo);
  const servicoSync = new ServicoSync(repo);
  const autenticacao = new AutenticadorSupabase(new VerificadorTokenSupabase(db));
  const gerenciadorConta = new GerenciadorContaSupabase(db);

  // C11 — expansão (pós-lançamento): lançamento manual de gôndola + moderação
  // (publica no pool pelo MESMO gate do cupom) e enriquecimento de produto. Os
  // endpoints são privilegiados; o gate de autorização usa tokens do ambiente.
  const servicoModeracao = new ServicoModeracao(repo, repo);
  const servicoCuradoria = new ServicoCuradoria(repo);
  const guardaCuradoria = new GuardaCuradoria(config.curadoriaTokens);

  return {
    servicoIngestao,
    reprocessador,
    registro,
    pipelineEstatistica,
    matcherTexto,
    servicoConsulta,
    servicoSync,
    autenticacao,
    gerenciadorConta,
    rollout,
    telemetria,
    servicoModeracao,
    servicoCuradoria,
    guardaCuradoria,
  };
}
