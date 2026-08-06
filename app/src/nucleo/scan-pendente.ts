/**
 * C7.1 — Entrega do EAN escaneado (modal de código de barras) → aba Verificar.
 *
 * Passar params por um navegador ANINHADO (stack modal → tab já montada) é
 * frágil no React Navigation: o parâmetro nem sempre chega à aba nem dispara o
 * efeito de foco de forma confiável. Este "correio" em memória é determinístico:
 * o scanner DEPOSITA o EAN e a Verificar o CONSOME ao ganhar foco (o evento de
 * foco sempre dispara quando o modal fecha). Estado efêmero, só de processo — não
 * persiste e não guarda dado nenhum além do último EAN pendente.
 *
 * `resolveItemListaId` (lista genérica, C12.1) é o elo com o item PENDENTE ("a
 * escolher no mercado") que mandou escanear: quando presente, a Verificar sabe
 * que este scan não é avulso — é a resolução de uma linha da lista, e deve
 * promovê-la para o produto real além de mostrar o veredito normalmente.
 */

export interface EanEscaneado {
  ean: string;
  /** Id da linha PENDENTE da lista de compras que motivou este scan, se houver. */
  resolveItemListaId?: string;
}

let pendente: EanEscaneado | null = null;

/** Guarda o EAN recém-lido (e a resolução pendente, se houver) para o próximo foco. */
export function depositarEanEscaneado(ean: string, opts?: { resolveItemListaId?: string }): void {
  pendente = {
    ean,
    ...(opts?.resolveItemListaId ? { resolveItemListaId: opts.resolveItemListaId } : {}),
  };
}

/** Consome (uma única vez) o EAN escaneado, ou `null` se não houver. */
export function consumirEanEscaneado(): EanEscaneado | null {
  const atual = pendente;
  pendente = null;
  return atual;
}
