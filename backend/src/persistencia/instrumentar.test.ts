/**
 * C10.4 — O proxy de instrumentação toca TODO acesso ao banco, então o risco
 * não é ele medir errado: é ele alterar o comportamento do repositório. Estes
 * testes travam a transparência — mesmo resultado, mesmo erro, mesmo `this` —
 * antes de conferir se a medição aconteceu.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Metricas } from '../observabilidade/metricas';
import { instrumentarRepositorio } from './instrumentar';

const espiao = (): Metricas & { chamadas: [string, number, boolean][] } => {
  const chamadas: [string, number, boolean][] = [];
  return {
    chamadas,
    observarBanco: (op, ms, ok) => chamadas.push([op, ms, ok]),
    observarCache: () => {},
    observarHttp: () => {},
  };
};

class RepoFake {
  private readonly interno = 'segredo';
  publico = 42;

  async buscar(id: string): Promise<string> {
    return `${this.interno}:${id}`;
  }

  async explodir(): Promise<never> {
    throw new Error('banco fora');
  }

  explodirSincrono(): string {
    throw new Error('erro síncrono');
  }

  calcular(n: number): number {
    return n * 2;
  }
}

describe('instrumentarRepositorio', () => {
  it('devolve o mesmo resultado do método original', async () => {
    const m = espiao();
    const repo = instrumentarRepositorio(new RepoFake(), m);

    // Inclui o acesso a `this.interno`: o método precisa enxergar os campos
    // privados do objeto real, não do proxy.
    expect(await repo.buscar('abc')).toBe('segredo:abc');
  });

  it('registra a operação pelo NOME DO MÉTODO', async () => {
    const m = espiao();
    const repo = instrumentarRepositorio(new RepoFake(), m);

    await repo.buscar('x');

    // Nome do método e não algo derivado do argumento — é o que mantém a
    // cardinalidade fixa em vez de uma série por id de cupom.
    expect(m.chamadas[0]?.[0]).toBe('buscar');
    expect(m.chamadas[0]?.[2]).toBe(true);
  });

  it('PROPAGA o erro intacto e o conta como falha', async () => {
    const m = espiao();
    const repo = instrumentarRepositorio(new RepoFake(), m);

    await expect(repo.explodir()).rejects.toThrow('banco fora');
    expect(m.chamadas[0]).toEqual(['explodir', expect.any(Number), false]);
  });

  it('propaga erro SÍNCRONO sem engolir', () => {
    const m = espiao();
    const repo = instrumentarRepositorio(new RepoFake(), m);

    expect(() => repo.explodirSincrono()).toThrow('erro síncrono');
    expect(m.chamadas[0]?.[2]).toBe(false);
  });

  it('não interfere em método síncrono bem-sucedido', () => {
    const m = espiao();
    const repo = instrumentarRepositorio(new RepoFake(), m);

    expect(repo.calcular(21)).toBe(42);
    // O custo de banco está sempre atrás de uma promessa — cronometrar helper
    // síncrono só encheria o painel de linhas de 0ms.
    expect(m.chamadas).toHaveLength(0);
  });

  it('deixa propriedades que não são função passar direto', () => {
    const repo = instrumentarRepositorio(new RepoFake(), espiao());

    expect(repo.publico).toBe(42);
  });

  it('devolve a MESMA função a cada acesso (identidade estável)', () => {
    const repo = instrumentarRepositorio(new RepoFake(), espiao());

    // Sem memoização, `repo.buscar !== repo.buscar` e quem guardasse a
    // referência passaria a se comportar diferente do objeto original.
    expect(repo.buscar).toBe(repo.buscar);
  });

  it('mede a duração da chamada', async () => {
    const m = espiao();
    const lento = {
      async devagar() {
        await new Promise((r) => setTimeout(r, 20));
      },
    };
    const repo = instrumentarRepositorio(lento, m);

    await repo.devagar();

    expect(m.chamadas[0]?.[1]).toBeGreaterThanOrEqual(15);
  });

  it('cobre método adicionado depois — o ponto de usar proxy', async () => {
    const m = espiao();
    const alvo: Record<string, () => Promise<string>> = {};
    const repo = instrumentarRepositorio(alvo, m);

    alvo.novoMetodo = () => Promise.resolve('ok');
    await repo.novoMetodo!();

    expect(m.chamadas[0]?.[0]).toBe('novoMetodo');
  });
});

describe('VerificadorTokenCache — hit/miss', () => {
  it('registra miss na primeira vez e hit na segunda', async () => {
    const { VerificadorTokenCache } = await import('../auth/verificador-token');
    const m = { hits: 0, misses: 0 };
    const metricas: Metricas = {
      observarBanco: () => {},
      observarHttp: () => {},
      observarCache: (_c, r) => (r === 'hit' ? m.hits++ : m.misses++),
    };
    const interno = { verificar: vi.fn().mockResolvedValue('usuario-1') };
    const cache = new VerificadorTokenCache(interno, 60_000, () => 1_000, metricas);

    await cache.verificar('token-abc');
    await cache.verificar('token-abc');

    expect(m).toEqual({ hits: 1, misses: 1 });
    // A prova de que o hit foi real: o GoTrue só foi consultado uma vez.
    expect(interno.verificar).toHaveBeenCalledTimes(1);
  });
});
