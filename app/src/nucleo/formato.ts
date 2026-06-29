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
