/**
 * C7.1 — Entrega do EAN escaneado (modal de código de barras) → aba Verificar.
 *
 * Passar params por um navegador ANINHADO (stack modal → tab já montada) é
 * frágil no React Navigation: o parâmetro nem sempre chega à aba nem dispara o
 * efeito de foco de forma confiável. Este "correio" em memória é determinístico:
 * o scanner DEPOSITA o EAN e a Verificar o CONSOME ao ganhar foco (o evento de
 * foco sempre dispara quando o modal fecha). Estado efêmero, só de processo — não
 * persiste e não guarda dado nenhum além do último EAN pendente.
 */

let eanPendente: string | null = null;

/** Guarda o EAN recém-lido para a Verificar pegar no próximo foco. */
export function depositarEanEscaneado(ean: string): void {
  eanPendente = ean;
}

/** Consome (uma única vez) o EAN escaneado, ou `null` se não houver. */
export function consumirEanEscaneado(): string | null {
  const ean = eanPendente;
  eanPendente = null;
  return ean;
}
