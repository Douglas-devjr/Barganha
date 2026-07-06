/**
 * C5.4 — Resolução da URL base da API. Ordem de prioridade:
 *   1. `EXPO_PUBLIC_API_URL` (env) — override explícito p/ produção/EAS ou
 *      backend remoto. Deixe VAZIO em dev local (veja o item 2).
 *   2. Host do Metro (dev) — reaproveita o IP em que o bundle foi servido.
 *   3. `extra.apiBaseUrl` do app.json → localhost (fallback final).
 *
 * Por que o item 2 existe: em device físico o backend roda na sua máquina, cujo
 * IP na LAN o DHCP troca a cada reinício. Como o próprio celular acabou de baixar
 * o JS do Metro (que roda nessa mesma máquina), `hostUri` já traz o IP ATUAL —
 * então derivamos o backend dele e nunca mais é preciso editar o `.env`.
 */

import Constants from 'expo-constants';

const PORTA = process.env.EXPO_PUBLIC_API_PORT || '3000';
const PADRAO = `http://localhost:${PORTA}`;

/**
 * IP/host onde o Metro está servindo o bundle — sempre o endereço ATUAL da
 * máquina de dev na LAN, mesmo que o DHCP o troque. Ausente em build
 * standalone/EAS. Ex.: `"192.168.15.7:8081"` → `"192.168.15.7"`.
 */
function hostDoMetro(): string | undefined {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig
      ?.debuggerHost;
  const host = hostUri?.split(':')[0];
  return host && host.length > 0 ? host : undefined;
}

export function obterBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env && env.length > 0) return env;

  const host = hostDoMetro();
  if (host) return `http://${host}:${PORTA}`;

  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  if (extra?.apiBaseUrl) return extra.apiBaseUrl;

  return PADRAO;
}
