/**
 * Parser de NFC-e de Minas Gerais (C11.1 — expansão de estados).
 *
 * O portal de MG (portalsped.fazenda.mg.gov.br) apresenta o emitente numa
 * tabela de cabeçalho (`.tbCab`) e cada item numa linha `tr.ItemNFCe` com
 * células próprias (`.prodDesc`, `.prodCod`, `.prodQtd`, `.prodUn`,
 * `.prodVlUnit`, `.prodVlTotal`, `.prodVlDesc`). É estruturalmente diferente
 * de RJ e SP — daí a interface comum (`ParserSefaz`) desacoplar os três e o
 * registro (`RegistroParsers`) resolver por UF sem o app saber de portal.
 *
 * Adicionar MG é só registrar este parser; o reprocessamento retroativo (C2.5)
 * passa a re-enfileirar automaticamente os QRs de MG guardados desde o dia 1.
 *
 * IMPORTANTE: o CPF do consumidor, se presente, NÃO é extraído (docs/04).
 */

import type { ItemEstruturado, NotaEstruturada } from '@barganha/shared';

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
import type { QrNfce } from './qr-payload';
import type { ClienteSefaz, ParserSefaz } from './tipos';

export const UF_MG = 'MG';
export const VERSAO_PARSER_MG = '2026.1';

function parseItemMg(linha: HTMLElement): ItemEstruturado {
  const descricao = exigir(textoLimpo(linha.querySelector('.prodDesc')?.text), 'descrição do item');
  const quantidade = numeroBr(linha.querySelector('.prodQtd')?.text);
  const unidade = exigir(textoLimpo(linha.querySelector('.prodUn')?.text), 'unidade do item');
  const valorTotal = numeroBr(linha.querySelector('.prodVlTotal')?.text);
  // Valor unitário pode faltar em itens de peso variável → deriva do total.
  const unitTexto = linha.querySelector('.prodVlUnit')?.text;
  const valorUnitario =
    unitTexto && /\d/.test(unitTexto)
      ? numeroBr(unitTexto)
      : quantidade !== 0
        ? valorTotal / quantidade
        : valorTotal;

  const ean = eanDeCodigo(linha.querySelector('.prodCod')?.text);
  const descontoTexto = linha.querySelector('.prodVlDesc')?.text;
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

/** HTML do portal de MG → `NotaEstruturada`. Puro e testável (sem rede). */
export function parseHtmlMg(html: string): NotaEstruturada {
  const raiz = parseHtml(html);

  const razaoSocial = exigir(textoDe(raiz, '.razaoEmit'), 'razão social');
  const cnpj = textoLimpo(raiz.querySelector('.cnpjEmit')?.text).replace(/\D/g, '');
  if (cnpj.length !== 14) {
    throw new FalhaParserSefazError('CNPJ do emitente ausente ou inválido no HTML de MG.');
  }

  const endereco = textoDe(raiz, '.endEmit');
  const { municipio, uf } = municipioUfDeEndereco(endereco);

  const itens = raiz.querySelectorAll('.ItemNFCe').map(parseItemMg);
  if (itens.length === 0) {
    throw new FalhaParserSefazError('Nota de MG sem itens — layout inesperado.');
  }

  const emitidoEm = dataHoraBrParaIso(textoDe(raiz, '.tbInfo .dataEmissao'));

  return {
    loja: {
      cnpj,
      razaoSocial,
      endereco,
      municipio: municipio ?? '',
      uf: uf ?? UF_MG,
    },
    emitidoEm,
    itens,
  };
}

/** Parser MG implementando o contrato comum (`ParserSefaz`). */
export class ParserMg implements ParserSefaz {
  readonly uf = UF_MG;
  readonly versao = VERSAO_PARSER_MG;

  constructor(private readonly cliente: ClienteSefaz) {}

  suportaUF(uf: string): boolean {
    return uf === this.uf;
  }

  async parse(qr: QrNfce): Promise<NotaEstruturada> {
    const html = await this.cliente.buscarConsulta(qr);
    return parseHtmlMg(html);
  }

  parseHtml(html: string): NotaEstruturada {
    return parseHtmlMg(html);
  }
}
