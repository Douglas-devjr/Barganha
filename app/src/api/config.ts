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

import { log } from '@/nucleo/log';

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

/** Hosts que NÃO funcionam a partir de um device físico. */
function inalcancavelDoDevice(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.exp.direct');
}

export function obterBaseUrl(): string {
  const url = exigirHttpsEmProducao(resolverBaseUrl());
  avisarSeInalcancavel(url);
  return url;
}

/**
 * Em build de produção, texto puro é inaceitável: TODA chamada privada leva o
 * JWT da sessão no header `Authorization`. Um `EXPO_PUBLIC_API_URL` com
 * `http://` — ou o fallback de dev vazando para um release — mandaria a
 * credencial em claro para quem estiver na mesma rede, sem sinal nenhum de que
 * isso está acontecendo.
 *
 * Falha ALTO, e não com um aviso: é erro de configuração de release, e o certo
 * é o app não subir com ele. Em `__DEV__` o http segue liberado — o backend
 * roda na LAN da máquina de desenvolvimento, sem TLS.
 */
function exigirHttpsEmProducao(url: string): string {
  if (__DEV__ || url.startsWith('https://')) return url;
  throw new Error(
    `[api] backend em texto puro (${url}) num build de produção. Defina ` +
      'EXPO_PUBLIC_API_URL com https:// — o token de sessão trafega nesse canal.',
  );
}

function resolverBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env && env.length > 0) return env;

  const host = hostDoMetro();
  if (host) return `http://${host}:${PORTA}`;

  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  if (extra?.apiBaseUrl) return extra.apiBaseUrl;

  return PADRAO;
}

/** Avisa UMA vez, em dev, quando a URL derivada não vai funcionar no aparelho. */
let avisou = false;
function avisarSeInalcancavel(url: string): void {
  if (!__DEV__ || avisou) return;
  avisou = true;

  const host = url.replace(/^https?:\/\//, '').split(':')[0] ?? '';
  log.info({ action: 'api.base_url', url }, 'Backend configurado');
  if (inalcancavelDoDevice(host)) {
    log.warn(
      { action: 'api.base_url_inalcancavel', host },
      `"${host}" aponta para o PRÓPRIO aparelho (ou um túnel sem backend) — ` +
        'num device físico isso vira "Network request failed". Suba o Metro na LAN ' +
        '(sem --tunnel/--localhost) ou defina EXPO_PUBLIC_API_URL=http://SEU_IP:3000 em app/.env.',
    );
  }
}
