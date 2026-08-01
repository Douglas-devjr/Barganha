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
 * Idade em linguagem de gente ("de hoje", "de ontem", "há 12 dias"). Recebe a
 * idade JÁ em dias (de `idadeEmDias`, do shared) para a regra de frescor ficar
 * num lugar só; aqui é só a redação.
 *
 * `undefined` → "sem data" e não "há 0 dias": data desconhecida não pode virar
 * uma promessa de frescor na tela.
 */
export function idadeTexto(dias: number | undefined): string {
  if (dias == null) return 'sem data';
  if (dias < 1) return 'de hoje';
  if (dias < 2) return 'de ontem';
  return `há ${Math.round(dias)} dias`;
}

/**
 * Quantas vezes o usuário já comprou o produto, em prosa ("comprou 3 vezes").
 *
 * Existe para essa contagem NUNCA voltar a aparecer como um número solto ao lado
 * de um preço ("típico R$ 5,49/L · 3 compras"): ali ela era lida como quantidade
 * do produto — 3 unidades por R$ 5,49 — e não como a evidência por trás do
 * típico. Em forma de frase, com verbo, não há como confundir com quantidade.
 */
export function vezesCompradas(n: number): string {
  if (n <= 0) return 'sem compra sua ainda';
  return n === 1 ? 'comprou 1 vez' : `comprou ${n} vezes`;
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

/**
 * Máscara de CNPJ enquanto o usuário digita (C11.3 — lançamento manual, onde a
 * loja é informada à mão por falta de uma tela de "escolher loja"). Aceita
 * colar com ou sem pontuação; sempre reformata a partir dos dígitos.
 */
export function mascararCnpj(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 14);
  const partes = [
    d.slice(0, 2),
    d.slice(2, 5),
    d.slice(5, 8),
    d.slice(8, 12),
    d.slice(12, 14),
  ].filter(Boolean);
  let saida = partes[0] ?? '';
  if (partes[1]) saida += `.${partes[1]}`;
  if (partes[2]) saida += `.${partes[2]}`;
  if (partes[3]) saida += `/${partes[3]}`;
  if (partes[4]) saida += `-${partes[4]}`;
  return saida;
}

/** Só os dígitos de um CNPJ mascarado — o formato que a API espera. */
export function somenteDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

/**
 * Validação SIMPLES (não o dígito verificador — o backend já rejeita CNPJ
 * inválido): 14 dígitos é o mínimo para não mandar uma loja pela metade.
 */
export function cnpjPareceValido(texto: string): boolean {
  return somenteDigitos(texto).length === 14;
}
