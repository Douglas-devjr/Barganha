import { describe, expect, it } from 'vitest';

import { Autenticador } from '../auth/autenticador';
import { ServicoConta } from '../auth/servico-conta';
import { ServicoConsulta } from '../consulta/servico-consulta';
import { FilaMemoria } from '../fila/fila-memoria';
import { ServicoIngestao } from '../ingestao/servico-ingestao';
import { RepositorioMemoria } from '../persistencia/repositorio-memoria';
import { ServicoSync } from '../sync/servico-sync';
import { LimitadorJanelaFixa } from './rate-limit';
import { construirServidor, LIMITES_PADRAO } from './servidor';

describe('LimitadorJanelaFixa (C9.3.2)', () => {
  it('libera até o máximo e barra o excedente dentro da janela', () => {
    const t = 1_000;
    const lim = new LimitadorJanelaFixa({ janelaMs: 100, maximo: 3, agora: () => t });

    expect(lim.permitir('ip-1')).toBe(true);
    expect(lim.permitir('ip-1')).toBe(true);
    expect(lim.permitir('ip-1')).toBe(true);
    expect(lim.permitir('ip-1')).toBe(false); // 4ª na mesma janela
  });

  it('zera a contagem quando a janela vira', () => {
    let t = 0;
    const lim = new LimitadorJanelaFixa({ janelaMs: 100, maximo: 1, agora: () => t });

    expect(lim.permitir('ip-1')).toBe(true);
    expect(lim.permitir('ip-1')).toBe(false);
    t += 100; // nova janela
    expect(lim.permitir('ip-1')).toBe(true);
  });

  it('conta cada chave isoladamente', () => {
    const t = 0;
    const lim = new LimitadorJanelaFixa({ janelaMs: 100, maximo: 1, agora: () => t });

    expect(lim.permitir('ip-1')).toBe(true);
    expect(lim.permitir('ip-2')).toBe(true); // outra chave, próprio orçamento
    expect(lim.permitir('ip-1')).toBe(false);
  });
});

function montarApp(limiteConta: number) {
  const repo = new RepositorioMemoria();
  const fila = new FilaMemoria(() => Promise.resolve(), { dormir: () => Promise.resolve() });
  return construirServidor({
    servicoIngestao: new ServicoIngestao(repo, fila),
    servicoConsulta: new ServicoConsulta(repo, repo),
    servicoSync: new ServicoSync(repo),
    servicoConta: new ServicoConta(repo),
    autenticacao: new Autenticador(repo),
    limites: { ...LIMITES_PADRAO, conta: { janelaMs: 60_000, maximo: limiteConta } },
  });
}

describe('Rate-limit no servidor (C9.3.2)', () => {
  it('responde 429 quando a criação de conta estoura o teto', async () => {
    const app = montarApp(2);
    await app.ready();
    try {
      const a = await app.inject({ method: 'POST', url: '/conta/anonima' });
      const b = await app.inject({ method: 'POST', url: '/conta/anonima' });
      const c = await app.inject({ method: 'POST', url: '/conta/anonima' });

      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      expect(c.statusCode).toBe(429);
      expect(c.json().erro).toMatch(/muitas requisições/i);
    } finally {
      await app.close();
    }
  });
});
