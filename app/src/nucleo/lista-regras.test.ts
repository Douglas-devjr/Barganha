/**
 * C12.1 — regra pura da chave de de-duplicação da lista de compras.
 */

import { describe, expect, it } from 'vitest';

import { calcularChaveItemLista } from './lista-regras';

describe('calcularChaveItemLista', () => {
  it('usa o id canônico quando o produto já foi identificado', () => {
    expect(calcularChaveItemLista('prod-123', 'Arroz Tipo 1')).toBe('prod-123');
  });

  it('usa a descrição normalizada quando não há id canônico (item pendente)', () => {
    expect(calcularChaveItemLista(null, 'Sabão em pó')).toBe('generico:SABAO EM PO');
  });

  it('duas grafias do mesmo nome pendente colidem na mesma chave', () => {
    const a = calcularChaveItemLista(null, 'SABÃO EM PÓ');
    const b = calcularChaveItemLista(null, '  Sabão em Pó  ');
    expect(a).toBe(b);
  });

  it('nomes pendentes diferentes não colidem', () => {
    expect(calcularChaveItemLista(null, 'Arroz')).not.toBe(calcularChaveItemLista(null, 'Feijão'));
  });
});
