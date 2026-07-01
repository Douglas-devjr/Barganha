/**
 * Parser de NFC-e do Rio de Janeiro (C2.2).
 *
 * O portal do RJ apresenta a nota numa tabela com uma linha por item
 * (colunas: descrição, código, qtd, unidade, valor unit., valor total). O
 * `parseHtmlRj` é puro (HTML → `NotaEstruturada`) e testado com fixtures; a
 * busca na SEFAZ fica no `ClienteSefaz` injetado.
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

export const UF_RJ = 'RJ';
export const VERSAO_PARSER_RJ = '2026.1';

/** Separa "Cidade/UF" ou "Cidade - UF" no fim do endereço. */
function municipioUf(endereco: string): { municipio?: string; uf?: string } {
  const m = endereco.match(/([^/-]+?)\s*[/-]\s*([A-Z]{2})\s*$/);
  if (!m) return {};
  return { municipio: textoLimpo(m[1]), uf: m[2] };
}

function parseItemRj(linha: HTMLElement): ItemEstruturado {
  const descricao = exigir(textoLimpo(linha.querySelector('.descItem')?.text), 'descrição do item');
  const quantidade = numeroBr(linha.querySelector('.qtdItem')?.text);
  const unidade = exigir(textoLimpo(linha.querySelector('.unItem')?.text), 'unidade do item');
  const valorTotal = numeroBr(linha.querySelector('.vlTotalItem')?.text);
  // Valor unitário pode faltar em alguns itens (peso variável) → deriva do total.
  const unitTexto = linha.querySelector('.vlUnitItem')?.text;
  const valorUnitario =
    unitTexto && /\d/.test(unitTexto)
      ? numeroBr(unitTexto)
      : quantidade !== 0
        ? valorTotal / quantidade
        : valorTotal;

  const ean = eanDeCodigo(linha.querySelector('.codItem')?.text);
  const descontoTexto = linha.querySelector('.vlDescItem')?.text;
  const desconto = descontoTexto && /\d/.test(descontoTexto) ? numeroBr(descontoTexto) : undefined;

  return {
    descricao,
    ...(ean ? { ean } : {}),
    quantidade,
    unidade,
    valorUnitario,
    valorTotal,
    ...(desconto && desconto > 0 ? { desconto } : {}),
  };
}

/** HTML do portal do RJ → `NotaEstruturada`. Puro e testável (sem rede). */
export function parseHtmlRj(html: string): NotaEstruturada {
  const raiz = parseHtml(html);

  const razaoSocial = exigir(textoDe(raiz, '.NFCCabecalho h4'), 'razão social');
  const cnpjBruto = raiz
    .querySelectorAll('.NFCCabecalho span')
    .map((s) => s.text)
    .find((t) => /CNPJ/i.test(t));
  const cnpj = textoLimpo(cnpjBruto).replace(/\D/g, '');
  if (cnpj.length !== 14) {
    throw new FalhaParserSefazError('CNPJ do emitente ausente ou inválido no HTML do RJ.');
  }

  const endereco = textoDe(raiz, '.NFCCabecalho .endereco');
  const { municipio, uf } = municipioUf(endereco);

  const itens = raiz.querySelectorAll('.linhaItem').map(parseItemRj);
  if (itens.length === 0) {
    throw new FalhaParserSefazError('Nota do RJ sem itens — layout inesperado.');
  }

  const emitidoEm = dataHoraBrParaIso(textoDe(raiz, '.NFCRodape .dataEmissao'));

  return {
    loja: {
      cnpj,
      razaoSocial,
      endereco,
      municipio: municipio ?? '',
      uf: uf ?? UF_RJ,
    },
    emitidoEm,
    itens,
  };
}

/** Parser RJ implementando o contrato comum (`ParserSefaz`). */
export class ParserRj implements ParserSefaz {
  readonly uf = UF_RJ;
  readonly versao = VERSAO_PARSER_RJ;

  constructor(private readonly cliente: ClienteSefaz) {}

  suportaUF(uf: string): boolean {
    return uf === this.uf;
  }

  async parse(qr: QrNfce): Promise<NotaEstruturada> {
    const html = await this.cliente.buscarConsulta(qr);
    return parseHtmlRj(html);
  }

  parseHtml(html: string): NotaEstruturada {
    return parseHtmlRj(html);
  }
}
