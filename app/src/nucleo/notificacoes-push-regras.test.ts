/**
 * C8.4 — Toque no push de alerta: o que o app deve abrir.
 *
 * O que estes casos protegem, na prática: o usuário toca "Preço baixou" e cai
 * no produto certo, UMA vez — sem tela empilhada no arranque frio e sem o app
 * quebrar por um payload que não veio como se esperava (é dado de fora).
 */

import { describe, expect, it } from 'vitest';

import { decidirAberturaPorToque } from './notificacoes-push-regras';

const TOQUE = {
  identificador: 'push-1',
  dados: { produtoCanonicoId: 'arroz-5kg' },
};

describe('decidirAberturaPorToque', () => {
  it('abre o produto que veio no push', () => {
    expect(decidirAberturaPorToque(TOQUE, null)).toEqual({
      identificador: 'push-1',
      produtoCanonicoId: 'arroz-5kg',
    });
  });

  it('ignora a repetição do MESMO toque — arranque frio entrega duas vezes', () => {
    expect(decidirAberturaPorToque(TOQUE, 'push-1')).toBeNull();
  });

  it('trata um toque novo depois de um já tratado', () => {
    const outro = { identificador: 'push-2', dados: { produtoCanonicoId: 'leite-1l' } };
    expect(decidirAberturaPorToque(outro, 'push-1')).toEqual({
      identificador: 'push-2',
      produtoCanonicoId: 'leite-1l',
    });
  });

  it('não faz nada quando não houve toque nenhum (app aberto pelo ícone)', () => {
    expect(decidirAberturaPorToque(null, null)).toBeNull();
    expect(decidirAberturaPorToque(undefined, null)).toBeNull();
  });

  it('memoriza o toque mesmo sem produto — aviso sem produto não navega', () => {
    for (const dados of [undefined, null, {}, 'texto', 42, { produtoCanonicoId: '' }]) {
      const decisao = decidirAberturaPorToque({ identificador: 'push-x', dados }, null);
      expect(decisao).toEqual({ identificador: 'push-x', produtoCanonicoId: null });
    }
  });

  it('rejeita produtoCanonicoId que não é string — o payload vem de fora', () => {
    for (const produtoCanonicoId of [123, null, {}, ['arroz'], true]) {
      const decisao = decidirAberturaPorToque(
        { identificador: 'push-y', dados: { produtoCanonicoId } },
        null,
      );
      expect(decisao?.produtoCanonicoId).toBeNull();
    }
  });
});
