/**
 * Parser do layout ENCAT "consulta via consumidor" — o padrão NACIONAL de
 * consulta de NFC-e adotado por vários estados (SP desde o C2.3; o RJ atual, em
 * `consultadfe.fazenda.rj.gov.br`, também). Uma `#tabResult` com um conjunto de
 * `<span>` por item (`.txtTit` descrição, `.RCod` código, `.Rqtd` qtd, `.RUN`
 * unidade, `.RvlUnit` valor unit., `.valor` total) e o cabeçalho em `.txtTopo` +
 * `#conteudo .text`. Puro e testável (sem rede).
 *
 * `ufPadrao` é só o FALLBACK quando o endereço não traz a UF — a UF canônica vem
 * da CHAVE (cUF) no processamento e sobrepõe esta (docs/03).
 *
 * IMPORTANTE: o CPF do consumidor, se presente, NÃO é extraído (docs/04).
 */

import type { ItemEstruturado, NotaEstruturada, TotaisNota } from '@barganha/shared';

import { FalhaParserSefazError } from '../erros';
import {
  dataHoraBrParaIso,
  eanDeCodigo,
  exigir,
  municipioUfDeEndereco,
  numeroBr,
  parseHtml,
  textoDe,
  textoLimpo,
  type HTMLElement,
} from './html';

/** Remove rótulos do tipo "Qtde.:", "UN:", "Vl. Unit.:" deixando só o valor. */
function aposRotulo(texto: string | undefined): string {
  return textoLimpo(texto).replace(/^.*?:\s*/, '');
}

/**
 * `.RCod` vem como "(Código: 0000000002)" — remove o rótulo (como `aposRotulo`
 * já faz para `.Rqtd`/`.RUN`/`.RvlUnit`) e os parênteses que só o RCod tem.
 */
function codigoBrutoEncat(texto: string | undefined): string {
  return aposRotulo(texto).replace(/[()]/g, '').trim();
}

/** `numeroBr` que não lança — para campos best-effort (totais). */
function numeroBrSeguro(texto: string | undefined | null): number | undefined {
  if (!texto || !/\d/.test(texto)) return undefined;
  try {
    return numeroBr(texto);
  } catch {
    return undefined;
  }
}

/**
 * Extrai os totais do cupom da seção `#totalNota` (bruto/desconto/pago). O layout
 * ENCAT casa cada linha `label` + `.totalNumb`; identificamos pelo rótulo
 * ("Valor total", "Descontos", "Valor a pagar"). Best-effort: se a seção não
 * existir ou não bater, devolve `undefined` (não derruba o parse da nota).
 */
export function extrairTotaisEncat(html: string): TotaisNota | undefined {
  const totalNota = parseHtml(html).querySelector('#totalNota');
  if (!totalNota) return undefined;

  let bruto: number | undefined;
  let pago: number | undefined;
  let desconto = 0;

  for (const linha of totalNota.querySelectorAll('div')) {
    const rotulo = textoLimpo(linha.querySelector('label')?.text);
    const valor = numeroBrSeguro(linha.querySelector('.totalNumb')?.text);
    if (!rotulo || valor === undefined) continue;

    if (/a\s*pagar/i.test(rotulo)) pago = valor;
    else if (/desconto/i.test(rotulo)) desconto = Math.abs(valor);
    else if (/valor\s*total/i.test(rotulo)) bruto = valor;
  }

  if (bruto === undefined && pago === undefined) return undefined;
  const brutoFinal = bruto ?? (pago as number) + desconto;
  const pagoFinal = pago ?? Math.max(0, brutoFinal - desconto);
  return { bruto: brutoFinal, desconto, pago: pagoFinal };
}

function parseItemEncat(item: HTMLElement): ItemEstruturado {
  const descricao = exigir(textoLimpo(item.querySelector('.txtTit')?.text), 'descrição do item');
  const quantidade = numeroBr(aposRotulo(item.querySelector('.Rqtd')?.text));
  const unidade = exigir(aposRotulo(item.querySelector('.RUN')?.text), 'unidade do item');
  const valorUnitario = numeroBr(aposRotulo(item.querySelector('.RvlUnit')?.text));
  const valorTotal = numeroBr(item.querySelector('.valor')?.text);
  const codigoTexto = codigoBrutoEncat(item.querySelector('.RCod')?.text);
  const ean = eanDeCodigo(codigoTexto);
  // Código interno da loja (SKU) preservado só quando NÃO é EAN — o mesmo
  // texto como `ean` seria redundante (ver ItemEstruturado.codigoLoja).
  const codigoLoja = !ean && codigoTexto ? codigoTexto : undefined;

  return {
    descricao,
    ...(ean ? { ean } : {}),
    ...(codigoLoja ? { codigoLoja } : {}),
    quantidade,
    unidade,
    valorUnitario,
    valorTotal,
  };
}

/** HTML do portal ENCAT (consulta via consumidor) → `NotaEstruturada`. */
export function parseHtmlEncat(html: string, ufPadrao: string): NotaEstruturada {
  const raiz = parseHtml(html);

  const razaoSocial = exigir(textoDe(raiz, '.txtTopo'), 'razão social');

  const textos = raiz.querySelectorAll('#conteudo .text').map((d) => textoLimpo(d.text));
  const cnpj = (textos.find((t) => /CNPJ/i.test(t)) ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) {
    throw new FalhaParserSefazError('CNPJ do emitente ausente ou inválido no HTML (ENCAT).');
  }
  // Nunca deixa CNPJ nem PII (CPF/consumidor) entrarem no endereço (docs/04).
  const ehLinhaPii = (t: string): boolean => /CNPJ|CPF|consumidor/i.test(t);
  // Linha terminada em UF: no portal real é o ENDEREÇO COMPLETO numa linha só
  // ("RUA X, 123, BAIRRO, CIDADE, UF") — o município sai do último segmento.
  const linhaMunicipio = textos.find((t) => /[,\-/]\s*[A-Z]{2}\s*$/.test(t) && !ehLinhaPii(t));
  const { municipio, uf } = municipioUfDeEndereco(linhaMunicipio);
  const endereco = textos.filter((t) => !ehLinhaPii(t)).join(', ');

  const itens = raiz.querySelectorAll('#tabResult tr').map(parseItemEncat);
  if (itens.length === 0) {
    throw new FalhaParserSefazError('Nota sem itens no HTML (ENCAT) — layout inesperado.');
  }

  const emissaoTexto = raiz
    .querySelectorAll('#infos li')
    .map((li) => li.text)
    .find((t) => /Emiss[ãa]o/i.test(t));
  const emitidoEm = dataHoraBrParaIso(emissaoTexto);

  const total = extrairTotaisEncat(html);

  return {
    loja: {
      cnpj,
      razaoSocial,
      endereco,
      municipio: municipio ?? '',
      uf: uf ?? ufPadrao,
    },
    emitidoEm,
    itens,
    ...(total ? { total } : {}),
  };
}
