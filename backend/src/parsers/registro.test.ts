import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { UfNaoSuportadaError } from '../erros';
import { ClienteSefazMemoria } from '../sefaz/cliente-sefaz-memoria';
import { parseQrNfce } from './qr-payload';
import { RegistroParsers } from './registro';
import { ParserRj } from './rj';
import { ParserSp } from './sp';

const htmlRj = readFileSync(
  fileURLToPath(new URL('./__fixtures__/rj-nota-1.html', import.meta.url)),
  'utf8',
);
const htmlSp = readFileSync(
  fileURLToPath(new URL('./__fixtures__/sp-nota-1.html', import.meta.url)),
  'utf8',
);

const QR_RJ =
  'https://www.fazenda.rj.gov.br/nfce/qrcode?p=33260612345678000199650010000000011000000016|2|1';

function registro(): RegistroParsers {
  const cliente = new ClienteSefazMemoria({ RJ: htmlRj, SP: htmlSp });
  return new RegistroParsers([new ParserRj(cliente), new ParserSp(cliente)]);
}

describe('RegistroParsers (C2)', () => {
  it('lista as UFs suportadas (RJ + SP)', () => {
    expect(registro().ufsSuportadas()).toEqual(['RJ', 'SP']);
  });

  it('resolve o parser por UF e parseia ponta a ponta', async () => {
    const qr = parseQrNfce(QR_RJ);
    const parser = registro().resolver('RJ');
    const nota = await parser.parse(qr);
    expect(nota.loja.cnpj).toBe('12345678000199');
    expect(parser.versao).toMatch(/\d{4}/);
  });

  it('lança UfNaoSuportadaError para UF sem parser', () => {
    expect(() => registro().resolver('MG')).toThrow(UfNaoSuportadaError);
    expect(registro().suporta('MG')).toBe(false);
  });
});
