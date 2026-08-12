import { describe, expect, it } from 'vitest';

import {
  apenasDigitos,
  chaveAcessoValida,
  digitoVerificadorChave,
  extrairChaveCruaDoQr,
  extrairChaveDoQr,
} from './chave-acesso';

/** Chave real de fixture (DV confere) — a mesma usada nos testes do RJ. */
const CHAVE = '33260612345678000199650010000000011000000016';
/** Mesma chave com o último dígito trocado: DV quebrado. */
const CHAVE_DV_RUIM = `${CHAVE.slice(0, 43)}7`;

describe('chaveAcessoValida', () => {
  it('aceita a chave de 44 dígitos com DV correto', () => {
    expect(chaveAcessoValida(CHAVE)).toBe(true);
  });

  it('recusa DV incorreto', () => {
    expect(chaveAcessoValida(CHAVE_DV_RUIM)).toBe(false);
  });

  it('recusa tamanho diferente de 44', () => {
    expect(chaveAcessoValida(CHAVE.slice(0, 43))).toBe(false);
    expect(chaveAcessoValida(`${CHAVE}0`)).toBe(false);
    expect(chaveAcessoValida('')).toBe(false);
  });

  it('ignora separadores e espaços antes de conferir', () => {
    expect(chaveAcessoValida(CHAVE.replace(/(\d{4})/g, '$1 '))).toBe(true);
  });

  it('concorda com o DV calculado sobre os 43 primeiros dígitos', () => {
    expect(digitoVerificadorChave(CHAVE.slice(0, 43))).toBe(Number(CHAVE[43]));
  });
});

describe('extrairChaveCruaDoQr', () => {
  it('tira a chave do parâmetro `p` (primeiro campo antes do `|`)', () => {
    const qr = `https://www.fazenda.rj.gov.br/nfce/qrcode?p=${CHAVE}|2|1|cId|hash`;
    expect(extrairChaveCruaDoQr(qr)).toBe(CHAVE);
  });

  it('aceita `p` com um campo só (sem separador)', () => {
    expect(extrairChaveCruaDoQr(`https://portal.sefaz/consulta?p=${CHAVE}`)).toBe(CHAVE);
  });

  it('cai para `chNFe` quando não há `p`', () => {
    expect(extrairChaveCruaDoQr(`https://portal.sefaz/consulta?chNFe=${CHAVE}`)).toBe(CHAVE);
  });

  it('cai para `chave` quando não há `p` nem `chNFe`', () => {
    expect(extrairChaveCruaDoQr(`https://portal.sefaz/consulta?chave=${CHAVE}`)).toBe(CHAVE);
  });

  it('aceita o payload que é só a chave', () => {
    expect(extrairChaveCruaDoQr(CHAVE)).toBe(CHAVE);
  });

  it('aceita a chave solta no meio de um texto qualquer', () => {
    expect(extrairChaveCruaDoQr(`NFC-e ${CHAVE} emitida`)).toBe(CHAVE);
  });

  it('NÃO valida o DV — devolve a chave quebrada para quem chama decidir', () => {
    // É o que deixa o backend distinguir "não achei chave" de "achei uma chave
    // inválida" (erros diferentes para o app).
    expect(extrairChaveCruaDoQr(`https://portal.sefaz/x?p=${CHAVE_DV_RUIM}`)).toBe(CHAVE_DV_RUIM);
  });

  it('devolve undefined quando não há nada com 44 dígitos', () => {
    expect(extrairChaveCruaDoQr('https://portal.sefaz/consulta?p=123|2|1')).toBeUndefined();
    expect(extrairChaveCruaDoQr('texto sem chave')).toBeUndefined();
  });
});

describe('extrairChaveDoQr (o que o app usa na captura)', () => {
  it('devolve a chave conferida a partir do QR completo', () => {
    const qr = `https://www.fazenda.rj.gov.br/nfce/qrcode?p=${CHAVE}|2|1|cId|hash`;
    expect(extrairChaveDoQr(qr)).toBe(CHAVE);
  });

  it('devolve undefined quando o DV não confere (sem dedup sobre chave quebrada)', () => {
    expect(extrairChaveDoQr(`https://portal.sefaz/x?p=${CHAVE_DV_RUIM}`)).toBeUndefined();
  });

  it('devolve undefined para payload vazio ou só espaços — nunca lança', () => {
    expect(extrairChaveDoQr('')).toBeUndefined();
    expect(extrairChaveDoQr('   ')).toBeUndefined();
  });

  it('é estável: o mesmo QR sempre dá exatamente o mesmo texto', () => {
    // A propriedade que sustenta o dedup: se variasse, o índice único local e o
    // do servidor discordariam sobre o que é "o mesmo cupom".
    const variantes = [
      `https://www.fazenda.rj.gov.br/nfce/qrcode?p=${CHAVE}|2|1|cId|hash`,
      `HTTPS://WWW.FAZENDA.RJ.GOV.BR/nfce/qrcode?p=${CHAVE}|2|1`,
      `  https://portal.sefaz/consulta?p=${CHAVE}|2|1  `,
      CHAVE,
      CHAVE.replace(/(\d{4})/g, '$1 '),
    ];
    for (const v of variantes) expect(extrairChaveDoQr(v)).toBe(CHAVE);
  });

  it('QRs de cupons diferentes dão chaves diferentes', () => {
    const outra = '33260612345678000199650010000000021000000013';
    expect(chaveAcessoValida(outra)).toBe(true);
    expect(extrairChaveDoQr(`https://portal.sefaz/x?p=${outra}|2|1`)).not.toBe(
      extrairChaveDoQr(`https://portal.sefaz/x?p=${CHAVE}|2|1`),
    );
  });
});

describe('apenasDigitos', () => {
  it('remove tudo que não for dígito', () => {
    expect(apenasDigitos('33 26.06/1234-5678')).toBe('33260612345678');
    expect(apenasDigitos('sem digitos')).toBe('');
  });
});
