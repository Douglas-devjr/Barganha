/**
 * Leitura e validação das variáveis de ambiente do backend. Sem segredos no
 * código — tudo vem do ambiente (.env.example documenta o conjunto).
 */

export interface ConfigBackend {
  nodeEnv: string;
  porta: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
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
  };
}
