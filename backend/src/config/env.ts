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
   * SHA do commit no ar, exposto em `/saude` (C10.4). Sem ele, diante de um
   * incidente não há como saber QUAL versão está rodando — e a verificação
   * pós-deploy não consegue distinguir "a nova subiu" de "a antiga continua".
   * O Render injeta `RENDER_GIT_COMMIT` sozinho; fora dele, `desenvolvimento`.
   */
  versao: string;
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
    versao: (env.RENDER_GIT_COMMIT ?? env.APP_VERSAO ?? 'desenvolvimento').slice(0, 12),
  };
}

/** Lookback do job de recálculo (min). Inválido/ausente → 180; `0` = completo. */
function parseLookbackMinutos(bruto: string | undefined): number {
  if (bruto == null || bruto.trim() === '') return 180;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : 180;
}
