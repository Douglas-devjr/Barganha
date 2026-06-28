import { describe, expect, it } from 'vitest';

import { ChaveAcessoInvalidaError } from '../erros';
import { digitoVerificadorChave, MODELO_NFCE, parseChaveAcesso } from './chave-acesso';

// Chaves com dígito verificador válido (geradas pelo próprio algoritmo).
const CHAVE_RJ = '33260612345678000199650010000000011000000016';
const CHAVE_SP = '35260661585865000151650010000000011000000012';

describe('parseChaveAcesso (C2)', () => {
  it('decompõe uma chave válida do RJ', () => {
    const chave = parseChaveAcesso(CHAVE_RJ);
    expect(chave).toMatchObject({
      valor: CHAVE_RJ,
      cuf: '33',
      uf: 'RJ',
      anoMes: '2606',
      cnpj: '12345678000199',
      modelo: MODELO_NFCE,
    });
  });

  it('mapeia o cUF de SP para a sigla correta', () => {
    expect(parseChaveAcesso(CHAVE_SP).uf).toBe('SP');
  });

  it('ignora separadores e espaços na entrada', () => {
    const comRuido = `${CHAVE_RJ.slice(0, 4)} ${CHAVE_RJ.slice(4)}`;
    expect(parseChaveAcesso(comRuido).valor).toBe(CHAVE_RJ);
  });

  it('rejeita chave com tamanho errado', () => {
    expect(() => parseChaveAcesso('123')).toThrow(ChaveAcessoInvalidaError);
  });

  it('rejeita chave com dígito verificador inválido', () => {
    const corrompida = `${CHAVE_RJ.slice(0, 43)}${(Number(CHAVE_RJ[43]) + 1) % 10}`;
    expect(() => parseChaveAcesso(corrompida)).toThrow(ChaveAcessoInvalidaError);
  });

  it('calcula o DV por módulo 11', () => {
    expect(digitoVerificadorChave(CHAVE_RJ.slice(0, 43))).toBe(Number(CHAVE_RJ[43]));
    expect(digitoVerificadorChave(CHAVE_SP.slice(0, 43))).toBe(Number(CHAVE_SP[43]));
  });
});
