import { describe, expect, it } from 'vitest';

import { extrairTotaisEncat } from './encat';

/** Monta a seção de totais do layout ENCAT com as linhas informadas. */
function totalNota(linhas: [string, string][]): string {
  const divs = linhas
    .map(
      ([rotulo, valor]) =>
        `<div id="linhaTotal"><label>${rotulo}</label><span class="totalNumb">${valor}</span></div>`,
    )
    .join('');
  return `<div id="totalNota" class="txtRight">${divs}</div>`;
}

describe('extrairTotaisEncat (C2.6)', () => {
  it('extrai bruto, desconto e valor pago', () => {
    const html = totalNota([
      ['Qtd. total de itens:', '3'],
      ['Valor total R$:', '100,00'],
      ['Descontos R$:', '15,50'],
      ['Valor a pagar R$:', '84,50'],
    ]);
    expect(extrairTotaisEncat(html)).toEqual({ bruto: 100, desconto: 15.5, pago: 84.5 });
  });

  it('sem linha de desconto: desconto 0 e pago = bruto', () => {
    const html = totalNota([
      ['Valor total R$:', '42,00'],
      ['Valor a pagar R$:', '42,00'],
    ]);
    expect(extrairTotaisEncat(html)).toEqual({ bruto: 42, desconto: 0, pago: 42 });
  });

  it('deriva o bruto quando só há "a pagar" + desconto', () => {
    const html = totalNota([
      ['Descontos R$:', '10,00'],
      ['Valor a pagar R$:', '90,00'],
    ]);
    expect(extrairTotaisEncat(html)).toEqual({ bruto: 100, desconto: 10, pago: 90 });
  });

  it('devolve undefined quando não há seção de totais', () => {
    expect(extrairTotaisEncat('<div id="conteudo">sem totais</div>')).toBeUndefined();
  });
});
