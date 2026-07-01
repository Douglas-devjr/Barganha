/**
 * Parser de NFC-e de São Paulo (C2.3).
 *
 * O portal de SP usa o layout "via consumidor" da ENCAT: uma `#tabResult` com
 * um conjunto de `<span>` por item (`.txtTit` descrição, `.RCod` código,
 * `.Rqtd` qtd, `.RUN` unidade, `.RvlUnit` valor unit., `.valor` total). É
 * estruturalmente diferente do RJ — daí a interface comum desacoplar os dois.
 *
 * IMPORTANTE: o CPF do consumidor, se presente, NÃO é extraído (docs/04).
 */

import type { ItemEstruturado, NotaEstruturada } from '@barganha/shared';

import { FalhaParserSefazError } from '../erros';
import {
  dataHoraBrParaIso,
  eanDeCodigo,
  exigir,
  numeroBr,
  parseHtml,
  textoDe,
  textoLimpo,
  type HTMLElement,
} from './html';
import type { QrNfce } from './qr-payload';
import type { ClienteSefaz, ParserSefaz } from './tipos';

export const UF_SP = 'SP';
export const VERSAO_PARSER_SP = '2026.1';

/** Remove rótulos do tipo "Qtde.:", "UN:", "Vl. Unit.:" deixando só o valor. */
function aposRotulo(texto: string | undefined): string {
  return textoLimpo(texto).replace(/^.*?:\s*/, '');
}

function parseItemSp(item: HTMLElement): ItemEstruturado {
  const descricao = exigir(textoLimpo(item.querySelector('.txtTit')?.text), 'descrição do item');
  const quantidade = numeroBr(aposRotulo(item.querySelector('.Rqtd')?.text));
  const unidade = exigir(aposRotulo(item.querySelector('.RUN')?.text), 'unidade do item');
  const valorUnitario = numeroBr(aposRotulo(item.querySelector('.RvlUnit')?.text));
  const valorTotal = numeroBr(item.querySelector('.valor')?.text);
  const ean = eanDeCodigo(item.querySelector('.RCod')?.text);

  return {
    descricao,
    ...(ean ? { ean } : {}),
    quantidade,
    unidade,
    valorUnitario,
    valorTotal,
  };
}

/** HTML do portal de SP → `NotaEstruturada`. Puro e testável (sem rede). */
export function parseHtmlSp(html: string): NotaEstruturada {
  const raiz = parseHtml(html);

  const razaoSocial = exigir(textoDe(raiz, '.txtTopo'), 'razão social');

  const textos = raiz.querySelectorAll('#conteudo .text').map((d) => textoLimpo(d.text));
  const cnpj = (textos.find((t) => /CNPJ/i.test(t)) ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) {
    throw new FalhaParserSefazError('CNPJ do emitente ausente ou inválido no HTML de SP.');
  }
  // Nunca deixa CNPJ nem PII (CPF/consumidor) entrarem no endereço (docs/04).
  const ehLinhaPii = (t: string): boolean => /CNPJ|CPF|consumidor/i.test(t);
  // Linha do município no formato "SAO PAULO, SP" / "SAO PAULO - SP".
  const linhaMunicipio = textos.find((t) => /[,-]\s*[A-Z]{2}\s*$/.test(t) && !ehLinhaPii(t));
  const matchMun = linhaMunicipio?.match(/(.+?)\s*[,-]\s*([A-Z]{2})\s*$/);
  const endereco = textos.filter((t) => !ehLinhaPii(t)).join(', ');

  const itens = raiz.querySelectorAll('#tabResult tr').map(parseItemSp);
  if (itens.length === 0) {
    throw new FalhaParserSefazError('Nota de SP sem itens — layout inesperado.');
  }

  const emissaoTexto = raiz
    .querySelectorAll('#infos li')
    .map((li) => li.text)
    .find((t) => /Emiss[ãa]o/i.test(t));
  const emitidoEm = dataHoraBrParaIso(emissaoTexto);

  return {
    loja: {
      cnpj,
      razaoSocial,
      endereco,
      municipio: matchMun ? textoLimpo(matchMun[1]) : '',
      uf: matchMun?.[2] ?? UF_SP,
    },
    emitidoEm,
    itens,
  };
}

/** Parser SP implementando o contrato comum (`ParserSefaz`). */
export class ParserSp implements ParserSefaz {
  readonly uf = UF_SP;
  readonly versao = VERSAO_PARSER_SP;

  constructor(private readonly cliente: ClienteSefaz) {}

  suportaUF(uf: string): boolean {
    return uf === this.uf;
  }

  async parse(qr: QrNfce): Promise<NotaEstruturada> {
    const html = await this.cliente.buscarConsulta(qr);
    return parseHtmlSp(html);
  }

  parseHtml(html: string): NotaEstruturada {
    return parseHtmlSp(html);
  }
}
