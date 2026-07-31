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
import { VerificadorTokenCache, VerificadorTokenSupabase } from './auth/verificador-token';
import type { ConfigBackend } from './config/env';
import { ServicoBuscaProdutos } from './consulta/servico-busca-produtos';
import { ServicoComparacaoLista } from './consulta/servico-comparacao-lista';
import { ServicoConsulta } from './consulta/servico-consulta';
import { ServicoCuradoria } from './curadoria/servico-curadoria';
import { AgendadorRecalculo } from './estatistica/agendador-recalculo';
import { MatcherTexto } from './estatistica/casamento-texto';
import { PipelineEstatistica } from './estatistica/pipeline';
import { FilaMemoria } from './fila/fila-memoria';
import { ServicoIngestao } from './ingestao/servico-ingestao';
import { ServicoDenuncia } from './moderacao/servico-denuncia';
import { ServicoModeracao } from './moderacao/servico-moderacao';
import { log, logDeCupom } from './observabilidade/log';
import { MetricasMemoria } from './observabilidade/metricas';
import { sanitizarErro } from './observabilidade/sanitizar';
import { MonitorSaude } from './observabilidade/saude';
import { sondaBanco, sondaFila, sondaParsers, sondaTelemetria } from './observabilidade/sondas';
import type { FonteMetricas, Telemetria } from './observabilidade/telemetria';
import { TelemetriaPersistente } from './observabilidade/telemetria-persistente';
import { ParserMg } from './parsers/mg';
import { RegistroParsers } from './parsers/registro';
import { ParserRj } from './parsers/rj';
import { ParserSp } from './parsers/sp';
import { instrumentarRepositorio } from './persistencia/instrumentar';
import { RepositorioSupabase } from './persistencia/repositorio-supabase';
import { criarClienteSupabase } from './persistencia/supabase';
import { ProcessadorCupom } from './processamento/processador-cupom';
import { ReprocessadorRetroativo } from './processamento/reprocessamento';
import { ControleRollout } from './rollout/controle-rollout';
import { ClienteSefazHttp } from './sefaz/cliente-sefaz-http';
import { ServicoSync } from './sync/servico-sync';
import { ServicoSyncCatalogo } from './sync/servico-sync-catalogo';

export interface Backend {
  servicoIngestao: ServicoIngestao;
  reprocessador: ReprocessadorRetroativo;
  registro: RegistroParsers;
  /** Motor estatístico (C3): recalcula `preco_estatistica` a partir do pool. */
  pipelineEstatistica: PipelineEstatistica;
  /** Recálculo pós-ingestão em segundo plano, com coalescência por produto. */
  agendadorRecalculo: AgendadorRecalculo;
  /** Casamento por texto (C3.5) p/ itens sem EAN. */
  matcherTexto: MatcherTexto;
  /** API de consulta de preço com fallback geo (C4.1). */
  servicoConsulta: ServicoConsulta;
  /** Busca no catálogo regional — o cold start de quem não tem cupom (C4.4). */
  servicoBuscaProdutos: ServicoBuscaProdutos;
  /** Lista de compras comparada por loja (C12.1). */
  servicoComparacaoLista: ServicoComparacaoLista;
  /** Delta sync incremental do cache de estatística (C4.2). */
  servicoSync: ServicoSync;
  /** Delta de catálogo — nome/marca/categoria p/ o cache offline (C4.5). */
  servicoSyncCatalogo: ServicoSyncCatalogo;
  /** Autenticação dos endpoints privados (C4.3.1) — valida o JWT do Supabase. */
  autenticacao: Autenticacao;
  /** Apagamento de conta (C4.3.1) — direito ao apagamento (docs/04). */
  gerenciadorConta: GerenciadorContaSupabase;
  /** Gate de lançamento faseado por UF (C10.3). */
  rollout: ControleRollout;
  /** Telemetria de parsing por estado — fonte do `/metricas` + histórico durável (C10.2). */
  telemetria: Telemetria & FonteMetricas;
  /** Lançamento manual de gôndola + moderação (C11.3). */
  servicoModeracao: ServicoModeracao;
  /** Denúncia de preço + fila da curadoria (C12.5). */
  servicoDenuncia: ServicoDenuncia;
  /** Enriquecimento de produto pela curadoria (C11.5). */
  servicoCuradoria: ServicoCuradoria;
  /** Autorização dos endpoints de curadoria (C11) — token estático do ambiente. */
  guardaCuradoria: GuardaCuradoria;
  /** Health check detalhado (C10.4) — fonte de `/saude` e do gate de deploy. */
  saude: MonitorSaude;
  /** Latência de banco/HTTP, acerto de cache e custo do processo (C10.4). */
  metricasPerformance: MetricasMemoria;
}

export function montarBackend(config: ConfigBackend): Backend {
  const db = criarClienteSupabase(config.supabaseUrl, config.supabaseServiceRoleKey);

  // C10.4 — coletor único de performance. Montado antes de tudo porque o
  // repositório já nasce instrumentado: envolver aqui, na raiz de composição, é
  // o que faz TODO acesso ao banco ser cronometrado sem que nenhum serviço do
  // domínio saiba que existe medição acontecendo.
  const metricasPerformance = new MetricasMemoria();
  const repo = instrumentarRepositorio(new RepositorioSupabase(db), metricasPerformance);

  const cliente = new ClienteSefazHttp();
  const registro = new RegistroParsers([
    new ParserRj(cliente),
    new ParserSp(cliente),
    new ParserMg(cliente),
  ]);

  // C10 — lançamento faseado (quais UFs atender agora) + observabilidade do parsing.
  // Telemetria persiste no Postgres (tabela `telemetria_parsing`): no free tier a
  // instância dorme e o contador em memória zera — o histórico durável fica no banco.
  const rollout = new ControleRollout(config.ufsHabilitadas);
  const telemetria = new TelemetriaPersistente(db);

  // C3 — motor estatístico sobre o pool anônimo. Montado ANTES do processador
  // para ser o gatilho de recálculo pós-ingestão (sem ele o pool enche mas a
  // mediana/faixa do veredito nunca é construída).
  const pipelineEstatistica = new PipelineEstatistica(repo, repo);

  // Recálculo pós-ingestão fora do caminho crítico: o worker marca e segue; o
  // agendador coalesce (mesmo produto em vários cupons = um recálculo só).
  const agendadorRecalculo = new AgendadorRecalculo(pipelineEstatistica, {
    aoFalhar: (produtoCanonicoId, erro) => {
      // Não é perda: a trigger do pool já deixou o produto em
      // `produto_recalculo_pendente` e o job em lote (C3.1/C10) refaz. `warn`
      // porque a recuperação é automática — vira `error` só se o job em lote
      // também falhar, e é ELE quem alerta.
      log.warn(
        { action: 'estatistica.recalculo_falhou', produtoCanonicoId, erro: sanitizarErro(erro) },
        'Recálculo de produto falhou — o job em lote refaz',
      );
    },
  });

  const anonimizador = new Anonimizador(repo);
  const processador = new ProcessadorCupom(repo, registro, anonimizador, {
    rollout,
    telemetria,
    // Recalcula a estatística dos produtos que entraram no pool assim que o cupom
    // é processado — é o que faz o veredito na gôndola (C4.1) ter dados.
    aoPublicarPool: (ids) => {
      agendadorRecalculo.marcar(ids);
      return Promise.resolve();
    },
    // Congela o típico da região em cada item ANTES de o cupom entrar no pool.
    // Hoje quase nada casa (pool raso) e o snapshot fica vazio — a captura roda
    // assim mesmo porque a mediana de hoje é irrecuperável amanhã.
    fonteTipico: repo,
  });
  const fila = new FilaMemoria((t) => processador.processar(t.cupomId), {
    aoEsgotar: (tarefa, erro) => {
      // C10.2 — conta o esgotamento por estado e registra para investigação.
      telemetria.registrarParsing(tarefa.uf, 'transitorio_esgotado');
      // `error`: acabaram as tentativas, o cupom do usuário ficou represado e
      // só o reprocessamento retroativo (C2.5) o recupera. Exige ação humana.
      logDeCupom(tarefa.cupomId, tarefa.uf).error(
        { action: 'fila.esgotada', erro: sanitizarErro(erro) },
        'Tentativas esgotadas — cupom represado para reprocessamento retroativo',
      );
    },
  });

  // O processador também serve à ingestão por HTML (C2.6): o app colhe o HTML da
  // nota (WebView) quando o portal exige navegador/reCAPTCHA e o backend parseia.
  const servicoIngestao = new ServicoIngestao(repo, fila, processador);
  const reprocessador = new ReprocessadorRetroativo(repo, registro, fila);

  const matcherTexto = new MatcherTexto(repo);

  // C4 — API de consulta/sync (lê só o pool compartilhado) + auth real.
  // C4.3.1: login obrigatório (Supabase Auth). O Bearer é um JWT validado
  // contra o GoTrue; o `usuarioId` (= auth.users.id) só identifica o lado
  // PRIVADO — o pool segue anônimo (docs/04). Sem conta anônima em produção.
  const servicoConsulta = new ServicoConsulta(repo, repo);
  // C4.4 — sem isto, conta nova (zero cupom) fica sem produto nenhum p/ montar
  // lista ou comparar mercados (cold start, docs/20).
  const servicoBuscaProdutos = new ServicoBuscaProdutos(repo, repo);
  const servicoComparacaoLista = new ServicoComparacaoLista(repo);
  const servicoSync = new ServicoSync(repo);
  // C4.5 — o delta de estatística desce preço por id; este desce o NOME daquele
  // id. Sem ele o cache offline tem típico de produto que a tela não sabe nomear.
  const servicoSyncCatalogo = new ServicoSyncCatalogo(repo);
  // O cache evita uma ida ao GoTrue por request privado (o polling da tela da
  // nota revalidava o mesmo token dezenas de vezes/min). Só memoriza sucesso, e
  // por no máximo 60s — a revogação continua valendo, com esse atraso.
  const autenticacao = new AutenticadorSupabase(
    new VerificadorTokenCache(
      new VerificadorTokenSupabase(db),
      undefined,
      undefined,
      metricasPerformance,
    ),
  );
  const gerenciadorConta = new GerenciadorContaSupabase(db);

  // C11 — expansão (pós-lançamento): lançamento manual de gôndola + moderação
  // (publica no pool pelo MESMO gate do cupom) e enriquecimento de produto. Os
  // endpoints são privilegiados; o gate de autorização usa tokens do ambiente.
  const servicoModeracao = new ServicoModeracao(repo, repo);
  // C12.5 — denúncia: só enfileira sinal; não tem caminho de escrita no pool.
  const servicoDenuncia = new ServicoDenuncia(repo);
  const servicoCuradoria = new ServicoCuradoria(repo);
  const guardaCuradoria = new GuardaCuradoria(config.curadoriaTokens);

  // C10.4 — health check detalhado. A ordem das sondas é a do relatório; as
  // CRÍTICAS (banco, parsers) são as que reprovam o deploy — ver `saude.ts`.
  // A consulta da sonda de banco é a mais barata que existe aqui: uma linha por
  // índice primário, numa tabela que sempre existe.
  const saude = new MonitorSaude(
    [
      sondaBanco(() => db.from('produto_canonico').select('id').limit(1)),
      sondaParsers(rollout, (uf) => registro.suporta(uf)),
      sondaTelemetria(telemetria),
      sondaFila(() => fila.estado()),
    ],
    { versao: config.versao, ambiente: config.nodeEnv },
  );

  return {
    saude,
    metricasPerformance,
    servicoIngestao,
    reprocessador,
    registro,
    pipelineEstatistica,
    agendadorRecalculo,
    matcherTexto,
    servicoConsulta,
    servicoBuscaProdutos,
    servicoComparacaoLista,
    servicoSync,
    servicoSyncCatalogo,
    autenticacao,
    gerenciadorConta,
    rollout,
    telemetria,
    servicoModeracao,
    servicoDenuncia,
    servicoCuradoria,
    guardaCuradoria,
  };
}
