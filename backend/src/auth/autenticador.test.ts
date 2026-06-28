import { describe, expect, it } from 'vitest';

import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { Autenticador, extrairUsuarioId } from './autenticador';
import { ServicoConta } from './servico-conta';

describe('extrairUsuarioId (C4.3)', () => {
  it('lê do Authorization: Bearer (case-insensitive + trim)', () => {
    expect(extrairUsuarioId({ authorization: 'Bearer abc' })).toBe('abc');
    expect(extrairUsuarioId({ authorization: 'bearer  xyz ' })).toBe('xyz');
  });

  it('cai para o header legado x-usuario-id', () => {
    expect(extrairUsuarioId({ 'x-usuario-id': 'legado' })).toBe('legado');
  });

  it('prefere o Bearer ao header legado', () => {
    expect(extrairUsuarioId({ authorization: 'Bearer tok', 'x-usuario-id': 'legado' })).toBe('tok');
  });

  it('devolve undefined sem credencial', () => {
    expect(extrairUsuarioId({})).toBeUndefined();
    expect(extrairUsuarioId({ authorization: 'Basic zzz' })).toBeUndefined();
  });
});

describe('Autenticador (C4.3)', () => {
  it('resolve só contas que existem', async () => {
    const repo = new RepositorioMemoria();
    const auth = new Autenticador(repo);
    const { usuarioId } = await new ServicoConta(repo).criarAnonima();

    expect(await auth.resolver({ authorization: `Bearer ${usuarioId}` })).toBe(usuarioId);
    expect(await auth.resolver({ 'x-usuario-id': usuarioId })).toBe(usuarioId);
    expect(await auth.resolver({ authorization: 'Bearer nao-existe' })).toBeUndefined();
    expect(await auth.resolver({})).toBeUndefined();
  });
});
