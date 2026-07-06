/**
 * C8 — Formatação de exibição (moeda e data) compartilhada pelas telas de
 * histórico/perfil. Centraliza o "R$ x,yz" e a data curta pt-BR para nenhuma
 * tela precisar repetir a conversão.
 */

/** "R$ 12,34" — duas casas, vírgula decimal. */
export function moeda(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

/** Data curta pt-BR (dd/mm/aaaa). `null` quando a entrada é ausente/inválida. */
export function dataCurta(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR');
}

/**
 * Lê um valor em reais digitado ("7,90", "7.90", "1.234,56") como número.
 * O ÚLTIMO separador (vírgula ou ponto) é o decimal — cobre o teclado
 * `decimal-pad` em qualquer locale; os separadores anteriores são de milhar.
 * `null` quando não é um número positivo.
 */
export function parseMoeda(texto: string): number | null {
  const s = texto.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const normalizado =
    sep === -1
      ? s
      : `${s.slice(0, sep).replace(/[.,]/g, '')}.${s.slice(sep + 1).replace(/[.,]/g, '')}`;
  const n = Number(normalizado);
  return Number.isFinite(n) && n > 0 ? n : null;
}
