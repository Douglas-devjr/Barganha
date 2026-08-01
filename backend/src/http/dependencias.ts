/**
 * Contrato de dependências do servidor HTTP e os tetos de taxa (C9.3.2).
 *
 * Vive fora do `servidor.ts` para os módulos de rota (`rotas/*.ts`) poderem
 * tipar o que consomem sem importar o montador — o que criaria ciclo.
 *
 * Quase tudo é OPCIONAL de propósito: dependência ausente = rota não sobe. É o
 * padrão "nega fechado" do backend — uma feature mal configurada some do mapa em
 * vez de subir aberta.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Autenticacao } from '../auth/autenticador';
import type { AutorizacaoCuradoria } from '../auth/curadoria';
import type { GerenciadorConta } from '../auth/gerenciador-conta';
import type { ServicoConta } from '../auth/servico-conta';
import type { ServicoBuscaProdutos } from '../consulta/servico-busca-produtos';
import type { ServicoComparacaoLista } from '../consulta/servico-comparacao-lista';
import type { ServicoConsulta } from '../consulta/servico-consulta';
import type { ServicoCuradoria } from '../curadoria/servico-curadoria';
import type { ServicoConfirmacaoCasamento } from '../curadoria/servico-confirmacao-casamento';
import type { MatcherTexto } from '../estatistica/casamento-texto';
import type { ServicoIngestao } from '../ingestao/servico-ingestao';
import type { ServicoDenuncia } from '../moderacao/servico-denuncia';
import type { ServicoModeracao } from '../moderacao/servico-moderacao';
import type { FonteResumoMetricas, Metricas } from '../observabilidade/metricas';
import type { MonitorSaude } from '../observabilidade/saude';
import type { FonteMetricas } from '../observabilidade/telemetria';
import type { ReprocessadorRetroativo } from '../processamento/reprocessamento';
import type { ServicoSync } from '../sync/servico-sync';
import type { ServicoSyncCatalogo } from '../sync/servico-sync-catalogo';
import type { OpcoesLimite } from './rate-limit';

/** Tetos de taxa por janela (C9.3.2). Sobrescrevíveis (testes/infra). */
export interface LimitesTaxa {
  /** Criação de conta anônima — por IP (anti criação em massa). */
  conta: OpcoesLimite;
  /** Leitura pública (consulta + sync somados) — por IP (anti scraping). */
  leituraPublica: OpcoesLimite;
  /** Endpoints privados — por CONTA autenticada (anti-spam de fila). */
  ingestao: OpcoesLimite;
  /**
   * Endpoints privados — por IP, aplicado ANTES da autenticação. Segura o
   * flood de quem nem tem conta (cada tentativa custa uma verificação de token).
   * Folgado de propósito: uma operadora/NAT põe muitos usuários no mesmo IP.
   */
  privadoIp: OpcoesLimite;
  /**
   * Endpoints de CURADORIA — por IP. O token estático já autoriza, mas sem teto
   * um token vazado martelava o banco à vontade (e as rotas de fila varrem
   * tabela). Apertado: a curadoria é um punhado de operadores, não o público.
   */
  curadoriaIp: OpcoesLimite;
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

export const LIMITES_PADRAO: LimitesTaxa = {
  conta: { janelaMs: HORA, maximo: 20 },
  leituraPublica: { janelaMs: MINUTO, maximo: 120 },
  ingestao: { janelaMs: MINUTO, maximo: 60 },
  privadoIp: { janelaMs: MINUTO, maximo: 300 },
  curadoriaIp: { janelaMs: MINUTO, maximo: 60 },
};

export interface DependenciasHttp {
  /** Cliente Supabase para operações de banco em middlewares (ex.: rate-limit distribuído). */
  supabaseClient?: SupabaseClient;
  servicoIngestao: ServicoIngestao;
  servicoConsulta: ServicoConsulta;
  /** Lista de compras comparada por loja (C12.1). Omitido → rota não sobe. */
  servicoComparacaoLista?: ServicoComparacaoLista;
  /** Busca no catálogo regional (C4.4, cold start). Omitido → rota não sobe. */
  servicoBuscaProdutos?: ServicoBuscaProdutos;
  servicoSync: ServicoSync;
  /**
   * Delta de catálogo (C4.5) — desce nome/marca/categoria dos ids em cache para
   * o catálogo ficar navegável offline. Omitido → rota não sobe (o app continua
   * caindo na descrição crua do cupom, como antes desta etapa).
   */
  servicoSyncCatalogo?: ServicoSyncCatalogo;
  /**
   * Conta anônima (C4.3) — afordância de testes/legado. Em produção o login é
   * obrigatório (Supabase Auth), então este serviço NÃO é injetado e a rota
   * `POST /conta/anonima` nem sobe. Presente → rota disponível (e2e em memória).
   */
  servicoConta?: ServicoConta;
  /**
   * Autenticação dos endpoints PRIVADOS (C4.3.1). Em produção valida o JWT do
   * Supabase (login real); em testes, o UUID opaco da conta anônima.
   */
  autenticacao: Autenticacao;
  /** Apagamento de conta (direito ao apagamento, docs/04). Omitido → rota não sobe. */
  gerenciadorConta?: GerenciadorConta;
  /** Lançamento manual de gôndola + moderação (C11.3). Omitido → rotas não sobem. */
  servicoModeracao?: ServicoModeracao;
  /** Denúncia de preço + fila da curadoria (C12.5). Omitido → rotas não sobem. */
  servicoDenuncia?: ServicoDenuncia;
  /** Enriquecimento de produto pela curadoria (C11.5). Omitido → rota não sobe. */
  servicoCuradoria?: ServicoCuradoria;
  /** Sugestões de casamento por texto p/ a curadoria (C3.5). Omitido → rota não sobe. */
  matcherTexto?: Pick<MatcherTexto, 'sugerir'>;
  /** Confirmação de casamento por texto (C3.5). Omitido → rota não sobe. */
  servicoConfirmacaoCasamento?: ServicoConfirmacaoCasamento;
  /** Reprocessamento retroativo por UF (C11.1/C2.5) — gatilho operacional. */
  reprocessador?: ReprocessadorRetroativo;
  /** Autorização dos endpoints de CURADORIA (C11). Sem ela, as rotas não sobem. */
  autorizacaoCuradoria?: AutorizacaoCuradoria;
  /** Fonte de métricas de parsing por estado (C10.2) — exposta em `GET /metricas`. */
  metricas?: FonteMetricas;
  /**
   * Health check detalhado (C10.4). Omitido → o servidor monta um monitor SEM
   * sondas, que responde `ok`. É o único lugar onde "nega fechado" não vale: uma
   * rota de saúde que some quando mal configurada tira o serviço do ar no gate
   * do Render por um motivo que nada tem a ver com a saúde dele.
   */
  saude?: MonitorSaude;
  /**
   * Métricas de performance (C10.4) — latência HTTP/banco, cache e processo.
   * Escrita e leitura vêm juntas porque é o mesmo coletor: o hook `onResponse`
   * grava e `GET /metricas` lê. Omitido → o servidor não instrumenta.
   */
  metricasPerformance?: Metricas & FonteResumoMetricas;
  /** Tetos de taxa (C9.3.2). Omitido → `LIMITES_PADRAO`. */
  limites?: LimitesTaxa;
  /** Confia no `X-Forwarded-For` atrás de proxy/LB (C10) — IP real p/ rate-limit. */
  trustProxy?: boolean;
  logger?: boolean;
}
