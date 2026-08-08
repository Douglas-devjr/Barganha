/**
 * Leitura e validação das variáveis de ambiente do backend. Sem segredos no
 * código — tudo vem do ambiente (.env.example documenta o conjunto).
 */

import { parseCuradoriaTokens } from '../auth/curadoria';
import { parseUfsHabilitadas } from '../rollout/controle-rollout';

export interface ConfigBackend {
  nodeEnv: string;
  porta: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** UFs habilitadas no lançamento faseado (C10.3). Padrão: RJ + SP. */
  ufsHabilitadas: string[];
  /** Confia no `X-Forwarded-For` atrás de proxy/load balancer (C10) — IP real p/ rate-limit. */
  trustProxy: boolean;
  /** Tokens de curadoria (C11) — moderação de gôndola e enriquecimento. Vazio = curadoria desabilitada. */
  curadoriaTokens: string[];
  /**
   * Job em lote de recálculo de `preco_estatistica` (C3.1/C10): janela de
   * retrovisão em minutos. Recalcula os produtos com observação inserida nesse
   * intervalo — rede de segurança para o recálculo *best-effort* da ingestão.
   * `0` (ou negativo) → recálculo COMPLETO. Padrão: 180 (3h).
   */
  recalculoLookbackMinutos: number;
  /**
   * Fila de processamento DURÁVEL no Postgres (C2.1) — o padrão. Só desligue
   * (`FILA_DURAVEL=false`) para rodar com a fila em memória, o que exige UMA
   * instância: com duas, cada processo teria a sua lista e as duas processariam
   * os mesmos cupons. Útil em dev antes de aplicar a migração da fila.
   */
  filaDuravel: boolean;
  /**
   * Intervalo do poll da fila durável, em ms. É o atraso máximo para uma
   * instância notar trabalho que não passou pelo seu próprio `enfileirar`
   * (enfileirado por OUTRA instância, saindo do backoff, ou órfão de lease
   * vencida). Cada poll é uma consulta ao Postgres — não baixe sem motivo.
   */
  filaPollMs: number;
  /**
   * SHA do commit no ar, exposto em `/saude` (C10.4). Sem ele, diante de um
   * incidente não há como saber QUAL versão está rodando — e a verificação
   * pós-deploy não consegue distinguir "a nova subiu" de "a antiga continua".
   * O Render injeta `RENDER_GIT_COMMIT` sozinho; fora dele, `desenvolvimento`.
   */
  versao: string;
  /**
   * Chave de API da Resend (docs/04 — canal de e-mail transacional, C9.2).
   * Ausente por padrão: o canal fica DESLIGADO e `job:purga-inativos` nunca
   * avança (sem aviso, sem purga). Preencher junto com `emailRemetente` é o
   * que destrava o aviso de retenção por inatividade em produção.
   */
  emailApiKey?: string;
  /**
   * Remetente (`from`) verificado na Resend, usado no aviso de retenção por
   * inatividade. Ausente → `enviarEmail` fail-closed (ver `emailApiKey`).
   */
  emailRemetente?: string;
  /**
   * C9.2.2 (b6) — chave-mestra da cifra de `cupom.chave_acesso_cifrada` e
   * `item_cupom.descricao_cifrada` (docs/19 §8). Formato
   * `"<versao>:<chave-base64-32-bytes>"` (ver `seguranca/cifra.ts`). Ausente
   * por padrão — igual ao canal de e-mail, a AUSÊNCIA não derruba o processo:
   * só o caminho que grava/lê essas duas colunas falha, e falha alto (nunca
   * grava/lê texto puro como se estivesse cifrado). Preenchê-la é o que liga
   * a cifra "de verdade" — passo do gate da Fase 3, não desta migração.
   */
  cifraChaveAtual?: string;
  /**
   * C9.2.2 (b6) — chave da versão ANTERIOR, só usada para DECIFRAR linhas
   * gravadas antes de uma rotação. Nunca cifra nada de novo. Ausente fora de
   * uma janela de rotação (o caso normal). Ver o procedimento em docs/19 §8.
   */
  cifraChaveAnterior?: string;
}

export function lerConfig(env: NodeJS.ProcessEnv = process.env): ConfigBackend {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    const faltando = [
      supabaseUrl ? null : 'SUPABASE_URL',
      supabaseServiceRoleKey ? null : 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter((v): v is string => v !== null);
    throw new Error(`Variáveis de ambiente ausentes: ${faltando.join(', ')}.`);
  }

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    porta: Number(env.PORT ?? 3000),
    supabaseUrl,
    supabaseServiceRoleKey,
    ufsHabilitadas: parseUfsHabilitadas(env.UFS_HABILITADAS),
    trustProxy: env.TRUST_PROXY === 'true',
    curadoriaTokens: parseCuradoriaTokens(env.CURADORIA_TOKENS),
    recalculoLookbackMinutos: parseLookbackMinutos(env.RECALCULO_LOOKBACK_MINUTES),
    // Durável por padrão: a variável existe para DESLIGAR, não para ligar. Uma
    // instância a mais no Render não pode depender de alguém lembrar de um env.
    filaDuravel: env.FILA_DURAVEL !== 'false',
    filaPollMs: parsePollMs(env.FILA_POLL_MS),
    versao: (env.RENDER_GIT_COMMIT ?? env.APP_VERSAO ?? 'desenvolvimento').slice(0, 12),
    emailApiKey: env.RESEND_API_KEY,
    emailRemetente: env.EMAIL_REMETENTE,
    cifraChaveAtual: env.CIFRA_CHAVE_ATUAL,
    cifraChaveAnterior: env.CIFRA_CHAVE_ANTERIOR,
  };
}

/** Poll da fila durável (ms). Inválido/ausente → 5000; piso de 250ms. */
function parsePollMs(bruto: string | undefined): number {
  const padrao = 5_000;
  if (bruto == null || bruto.trim() === '') return padrao;
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 ? Math.max(250, n) : padrao;
}

/** Lookback do job de recálculo (min). Inválido/ausente → 180; `0` = completo. */
function parseLookbackMinutos(bruto: string | undefined): number {
  if (bruto == null || bruto.trim() === '') return 180;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : 180;
}
