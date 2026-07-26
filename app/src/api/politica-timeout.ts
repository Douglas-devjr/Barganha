/**
 * C5.4 — Orçamento de tempo de cada requisição ao backend.
 *
 * O backend roda no plano FREE do Render, que HIBERNA a instância após ~15 min
 * sem tráfego: o primeiro request depois de um período parado gasta 30–60s só
 * acordando o processo. Com um teto único de 15s esse request era abortado e
 * virava "Sem conexão com o servidor" — uma falha inventada, num caso em que o
 * servidor sequer chegou a recusar o dado.
 *
 * Subir o teto para todo mundo não serve: o timeout existe justamente para que
 * um servidor INALCANÇÁVEL (IP da LAN que mudou, firewall dropando pacote em
 * silêncio) caia rápido no estado offline em vez de pendurar a UI. Então o
 * orçamento é escolhido por contexto:
 *
 *   • houve resposta recente  → a instância está acordada     → teto curto;
 *   • silêncio além da janela → pode estar hibernando         → teto longo;
 *   • base local (`http://` na LAN, dev) → sempre curto: ali não existe
 *     hibernação, e o modo de falha real é o servidor não estar de pé.
 *
 * "Resposta recente" conta QUALQUER resposta HTTP, inclusive erro: um 404 ou um
 * 401 provam que o processo está no ar, que é a única coisa medida aqui.
 */

/** Servidor comprovadamente acordado (ou backend local). */
export const TIMEOUT_QUENTE_MS = 15_000;

/** Primeiro contato depois do silêncio: cabe o cold start do Render free. */
export const TIMEOUT_FRIO_MS = 60_000;

/**
 * Quanto tempo uma resposta continua servindo de prova de que a instância está
 * acordada. Bem abaixo dos ~15 min de ociosidade que fazem o Render hibernar —
 * é melhor conceder o teto longo à toa do que abortar um cold start legítimo.
 */
export const JANELA_QUENTE_MS = 5 * 60_000;

export interface ContextoTimeout {
  /** `false` para backend local de desenvolvimento (LAN, `http://`). */
  remoto: boolean;
  /** Epoch ms da última resposta HTTP recebida; `null` se nunca houve. */
  ultimoContatoEm: number | null;
  agora: number;
}

export function escolherTimeout({ remoto, ultimoContatoEm, agora }: ContextoTimeout): number {
  if (!remoto) return TIMEOUT_QUENTE_MS;
  if (ultimoContatoEm == null) return TIMEOUT_FRIO_MS;
  const silencio = agora - ultimoContatoEm;
  // Relógio para trás (fuso/NTP) não pode virar teto curto por acidente.
  if (silencio < 0 || silencio >= JANELA_QUENTE_MS) return TIMEOUT_FRIO_MS;
  return TIMEOUT_QUENTE_MS;
}

/** `true` quando a base aponta para um servidor remoto (produção/preview). */
export function ehRemoto(baseUrl: string): boolean {
  return baseUrl.startsWith('https://');
}
