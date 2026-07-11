/**
 * Utilidades de extração de HTML compartilhadas pelos parsers estaduais.
 * Encapsula o `node-html-parser` e a aritmética de números no formato BR.
 */

import { parse, type HTMLElement } from 'node-html-parser';

import { FalhaParserSefazError } from '../erros';

export type { HTMLElement };

/** Faz o parse do HTML e devolve a raiz para consulta via `querySelector`. */
export function parseHtml(html: string): HTMLElement {
  return parse(html);
}

/**
 * O portal respondeu com uma página de DEFESA anti-bot (não a nota):
 *  • bloqueio por IP (ex.: RJ barra faixas residenciais e mostra links de "meu IP");
 *  • desafio reCAPTCHA v3 + postback JSF (a nota só vem após resolver o desafio,
 *    o que só um navegador real — o do próprio usuário — consegue).
 * Não é HTML parseável de nota: quem busca deve tratar como falha de BUSCA
 * (transitória), nunca de PARSE (que marcaria o cupom como `falha` permanente).
 */
export function pareceDefesaAntiBot(html: string): boolean {
  return (
    /grecaptcha\.execute/i.test(html) || // gate reCAPTCHA v3 que dispara o postback JSF
    /whatismyipaddress\.com|meuip\.com\.br/i.test(html) // página de bloqueio por IP
  );
}

/** Colapsa espaços/quebras e remove pontas — texto de SEFAZ vem cheio deles. */
export function textoLimpo(texto: string | undefined | null): string {
  return (texto ?? '').replace(/\s+/g, ' ').trim();
}

/** Texto limpo do primeiro elemento que casa o seletor (ou `''`). */
export function textoDe(raiz: HTMLElement, seletor: string): string {
  return textoLimpo(raiz.querySelector(seletor)?.text);
}

/**
 * Converte um número no formato brasileiro ("1.234,56", "R$ 4,79", "2") em
 * `number`. Lança `FalhaParserSefazError` se não houver dígito reconhecível.
 */
export function numeroBr(texto: string | undefined | null): number {
  const limpo = textoLimpo(texto).replace(/[^\d.,-]/g, '');
  if (!limpo || !/\d/.test(limpo)) {
    throw new FalhaParserSefazError(`Valor numérico ausente ou ilegível: "${texto ?? ''}".`);
  }
  // Remove separador de milhar (.) e troca a vírgula decimal por ponto.
  const normalizado = limpo.replace(/\./g, '').replace(',', '.');
  const valor = Number(normalizado);
  if (Number.isNaN(valor)) {
    throw new FalhaParserSefazError(`Valor numérico inválido: "${texto ?? ''}".`);
  }
  return valor;
}

/** Exige um valor presente; senão acusa layout inesperado da SEFAZ. */
export function exigir<T>(valor: T | undefined | null, oQue: string): T {
  if (valor === undefined || valor === null || valor === '') {
    throw new FalhaParserSefazError(`Campo obrigatório ausente no HTML da SEFAZ: ${oQue}.`);
  }
  return valor;
}

/**
 * Converte "dd/mm/aaaa hh:mm[:ss]" (formato da SEFAZ) em ISO 8601 (UTC).
 * Assume fuso de Brasília (-03:00) — o Brasil não adota horário de verão.
 */
export function dataHoraBrParaIso(texto: string | undefined | null): string {
  const m = textoLimpo(texto).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    throw new FalhaParserSefazError(`Data/hora de emissão ilegível: "${texto ?? ''}".`);
  }
  const [, dd, mm, aaaa, hh, mi, ss] = m;
  const data = new Date(`${aaaa}-${mm}-${dd}T${hh}:${mi}:${ss ?? '00'}-03:00`);
  if (Number.isNaN(data.getTime())) {
    throw new FalhaParserSefazError(`Data/hora de emissão inválida: "${texto ?? ''}".`);
  }
  return data.toISOString();
}

/**
 * Extrai município e UF do FIM de uma linha de endereço da SEFAZ.
 *
 * Nos portais reais o endereço vem numa ÚNICA linha terminada na UF, com o
 * município no penúltimo segmento (formato posicional do ENCAT):
 *   "AVENIDA X, 123, CENTRO, RIO DE JANEIRO, RJ"
 *   "SAO PAULO, SP"                                 (linha só de cidade)
 *   "Av. Y, 500 - Copacabana - Rio de Janeiro/RJ"   (layout antigo do RJ)
 *
 * Um regex que capturasse "tudo antes da UF" pegaria o ENDEREÇO INTEIRO como
 * município — a chave `UF:MUNICIPIO` gravada nunca casaria com a cidade
 * escolhida no app e a média regional caía silenciosamente para a UF. Por isso:
 * isola-se a UF no fim e toma-se o ÚLTIMO segmento do restante (por vírgula;
 * dentro dele, por " - " ou "/") como município.
 */
export function municipioUfDeEndereco(texto: string | undefined | null): {
  municipio?: string;
  uf?: string;
} {
  const linha = textoLimpo(texto);
  const m = linha.match(/^(.*?)\s*[,\-/]\s*([A-Z]{2})\s*$/);
  if (!m) return {};
  const uf = m[2] as string;
  const porVirgula = (m[1] ?? '').split(',').at(-1) ?? '';
  // " - " (com espaços) não quebra municípios hifenizados (ex.: "NAO-ME-TOQUE").
  const municipio = textoLimpo(porVirgula.split(/\s+-\s+|\//).at(-1));
  if (!municipio || !/\p{L}/u.test(municipio)) return { uf };
  return { municipio, uf };
}

/**
 * Devolve o código como EAN/GTIN só quando tem comprimento de código de barras
 * (8/12/13/14 dígitos). Itens de hortifruti/padaria têm código interno da loja,
 * não EAN — esses voltam `undefined` e seguem para casamento por texto (C3.5).
 */
export function eanDeCodigo(texto: string | undefined | null): string | undefined {
  const digitos = textoLimpo(texto).replace(/\D/g, '');
  return [8, 12, 13, 14].includes(digitos.length) ? digitos : undefined;
}
