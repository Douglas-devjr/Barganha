/**
 * C5.4 — Resolução da URL base da API. Ordem de prioridade:
 *   1. `EXPO_PUBLIC_API_URL` (env, embutida no build pelo Expo)
 *   2. `extra.apiBaseUrl` do app.json
 *   3. localhost (dev)
 *
 * Em device físico, `localhost` aponta para o próprio aparelho — use o IP da
 * máquina (ex.: EXPO_PUBLIC_API_URL=http://192.168.0.10:3000).
 */

import Constants from 'expo-constants';

const PADRAO = 'http://localhost:3000';

export function obterBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env && env.length > 0) return env;

  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  if (extra?.apiBaseUrl) return extra.apiBaseUrl;

  return PADRAO;
}
