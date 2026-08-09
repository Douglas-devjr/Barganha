/**
 * C8.4 — Regra PURA do toque numa notificação push: "este evento deve abrir
 * alguma tela, e qual?".
 *
 * Mora fora de `notificacoes-push.ts` pelo motivo de sempre nesta pasta: aquele
 * arquivo importa `expo-notifications`/`expo-device` (nativo), então não roda
 * sob vitest. A decisão em si não depende de nada nativo — só do payload — e é
 * onde estão os casos de borda que valem teste.
 *
 * O caso de borda que justifica a dedupe: no arranque FRIO o mesmo toque chega
 * DUAS vezes — uma por `getLastNotificationResponseAsync` (a resposta que
 * lançou o app) e outra pelo listener, que já está montado a tempo de recebê-la
 * também. Sem lembrar o último identificador tratado, a tela do produto abriria
 * empilhada duas vezes e o "voltar" cairia nela de novo.
 */

/** O mínimo do `NotificationResponse` do expo que a decisão precisa. */
export interface ToqueNotificacao {
  /** `notification.request.identifier` — único por notificação entregue. */
  identificador: string;
  /** `notification.request.content.data` — payload cru, de fora do app. */
  dados: unknown;
}

export interface AberturaPorToque {
  /** Identificador a memorizar como tratado (mesmo sem produto para abrir). */
  identificador: string;
  /** Produto a abrir, ou `null` para aviso sem produto (nada a navegar). */
  produtoCanonicoId: string | null;
}

/**
 * Extrai `produtoCanonicoId` do payload do push (ver `jobs/alerta-preco.ts`).
 * O dado vem de FORA do app, então nada de confiar no formato: só string não
 * vazia passa.
 */
function produtoDoPayload(dados: unknown): string | null {
  if (typeof dados !== 'object' || dados === null) return null;
  const id = (dados as { produtoCanonicoId?: unknown }).produtoCanonicoId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Decide o que fazer com um toque. Devolve `null` quando não há nada a fazer:
 * evento ausente ou repetição de um já tratado.
 */
export function decidirAberturaPorToque(
  toque: ToqueNotificacao | null | undefined,
  ultimoTratado: string | null,
): AberturaPorToque | null {
  if (!toque) return null;
  if (toque.identificador === ultimoTratado) return null;
  return {
    identificador: toque.identificador,
    produtoCanonicoId: produtoDoPayload(toque.dados),
  };
}
